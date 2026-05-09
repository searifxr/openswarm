"""Tiny OpenAI-API pass-through with `max_tokens` → `max_completion_tokens`
rename for GPT-5.x models.

Why this exists
---------------
OpenAI's GPT-5 family (gpt-5.4-mini, gpt-5.5, gpt-5.3-codex, etc.)
rejects the legacy `max_tokens` parameter with HTTP 400:
    "Unsupported parameter: 'max_tokens' is not supported with this model.
     Use 'max_completion_tokens'."

Anthropic's CLI emits requests in Anthropic format (which uses `max_tokens`),
9Router 0.3.60 translates Anthropic→OpenAI and preserves `max_tokens`
(it doesn't know about the GPT-5 change). We can't bump 9Router because
0.3.60 is pinned to fix a separate WebSearch regression in the 0.3.x
range (see backend/apps/nine_router.py:27-36).

So we slot a thin proxy between 9Router and api.openai.com. The CLI is
unaware: it sees its OPENAI_BASE_URL pointing at this local passthrough,
not OpenAI. We rename the field for GPT-5 models and forward unchanged
otherwise. Streaming + non-streaming both work because we proxy bytes.

Mounted at `/api/openai-passthrough` and consumed by setting
OPENAI_BASE_URL to `http://127.0.0.1:<port>/api/openai-passthrough/v1`
in the CLI's spawn env (see agent_manager.py).
"""

import json
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

from backend.config.Apps import SubApp

logger = logging.getLogger(__name__)


@asynccontextmanager
async def openai_passthrough_lifespan():
    yield


openai_passthrough = SubApp("openai-passthrough", openai_passthrough_lifespan)


# Models that REQUIRE max_completion_tokens. Mirrors anthropic_proxy.py's
# matcher but lives here so this module doesn't depend on that one.
_GPT5_PREFIXES = ("gpt-5",)
_OPENAI_UPSTREAM = "https://api.openai.com/v1"
_HOP_HEADERS = {
    "host", "content-length", "connection", "keep-alive",
    "proxy-authenticate", "proxy-authorization", "te", "trailers",
    "transfer-encoding", "upgrade",
}


def _is_gpt5(model: str) -> bool:
    m = (model or "").strip().lower()
    if not m:
        return False
    # Strip routing prefixes 9Router may have added.
    for prefix in ("openai/", "cx/", "openrouter/", "or:openai/", "cp/", "cp-"):
        if m.startswith(prefix):
            m = m[len(prefix):]
            break
    return any(m.startswith(p) for p in _GPT5_PREFIXES)


def _scrub_max_tokens(body: bytes) -> bytes:
    """Rename max_tokens → max_completion_tokens for GPT-5 models.

    Bytes-in/out, never raises. No-op if body isn't JSON, model isn't GPT-5,
    or max_tokens isn't present. If both fields are present (unlikely),
    drops the legacy field so OpenAI doesn't 400 on the conflict.
    """
    if not body:
        return body
    try:
        parsed = json.loads(body)
    except Exception:
        return body
    if not isinstance(parsed, dict):
        return body
    model = str(parsed.get("model") or "")
    if not _is_gpt5(model):
        return body
    if "max_tokens" in parsed and "max_completion_tokens" not in parsed:
        parsed["max_completion_tokens"] = parsed.pop("max_tokens")
        return json.dumps(parsed).encode("utf-8")
    if "max_tokens" in parsed and "max_completion_tokens" in parsed:
        parsed.pop("max_tokens", None)
        return json.dumps(parsed).encode("utf-8")
    return body


@openai_passthrough.router.api_route(
    "/v1/{rest:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
)
async def passthrough(rest: str, request: Request):
    body = await request.body()
    body = _scrub_max_tokens(body)

    forward_headers: dict[str, str] = {}
    for k, v in request.headers.items():
        if k.lower() in _HOP_HEADERS:
            continue
        forward_headers[k] = v

    upstream_url = f"{_OPENAI_UPSTREAM}/{rest}"
    if request.url.query:
        upstream_url = f"{upstream_url}?{request.url.query}"

    # Stream upstream response body straight back to the caller. httpx's
    # streaming context handles Server-Sent Events the CLI uses for chat
    # completions without buffering the full response in memory.
    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=30.0))
    try:
        upstream_req = client.build_request(
            request.method,
            upstream_url,
            headers=forward_headers,
            content=body,
        )
        upstream_resp = await client.send(upstream_req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        logger.warning("openai-passthrough upstream error: %s", e)
        return JSONResponse(
            {"error": {"message": str(e), "type": "upstream_error"}},
            status_code=502,
        )

    response_headers: dict[str, str] = {}
    for k, v in upstream_resp.headers.items():
        if k.lower() in _HOP_HEADERS:
            continue
        response_headers[k] = v

    async def streamer():
        try:
            async for chunk in upstream_resp.aiter_raw():
                yield chunk
        finally:
            await upstream_resp.aclose()
            await client.aclose()

    return StreamingResponse(
        streamer(),
        status_code=upstream_resp.status_code,
        headers=response_headers,
    )
