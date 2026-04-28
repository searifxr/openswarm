#!/usr/bin/env python3
"""Stdio MCP server exposing the Outputs (Views) activation gate.

Same shape as mcp_meta_server.py but for the Outputs surface. The model
sees a one-line index of all available Outputs in the system prompt; to
get the full input_schema for a specific Output (so it can call
RenderOutput correctly), it must call OutputActivate first. The full
schema is then injected on the next turn.

Tools:
  - OutputList: enumerate all Outputs (active + available).
  - OutputSearch(query): rank by name/description match + use_count.
  - OutputActivate(output_id): pin the Output's schema into context.

Same security/anti-hallucination guarantees as mcp_meta_server: input
validated against the canonical store, unknown ids return the valid
options instead of activating.
"""

import json
import os
import sys
import urllib.error
import urllib.request

BACKEND_PORT = os.environ.get("OPENSWARM_PORT", "8324")
BACKEND_AUTH = os.environ.get("OPENSWARM_AUTH_TOKEN", "")
BACKEND_URL = f"http://127.0.0.1:{BACKEND_PORT}/api/outputs-meta"
PARENT_SESSION_ID = os.environ.get("OPENSWARM_PARENT_SESSION_ID", "")


TOOLS = [
    {
        "name": "OutputList",
        "description": (
            "List all reusable View artifacts (Outputs) installed on this "
            "machine. Returns one entry per Output with id, name, "
            "description, and activation status. The full input_schema "
            "is NOT included — call OutputActivate to load it. Use this "
            "for a broad survey before picking one."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "OutputSearch",
        "description": (
            "Find Outputs relevant to a query. Ranks by name/description "
            "match plus recent-use frequency. Returns the top matches "
            "without their schemas. Call OutputActivate after picking one."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Free-form description of what you want to render (e.g. 'inbox dashboard', 'sales chart').",
                },
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "OutputActivate",
        "description": (
            "Activate an Output for this session — pins its full input_schema "
            "into context starting next turn so RenderOutput can validate "
            "the input_data shape. Validate the id by calling OutputList or "
            "OutputSearch first; invalid ids return the valid options "
            "instead of activating."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "output_id": {
                    "type": "string",
                    "description": "Output id as returned by OutputList/OutputSearch.",
                },
                "reason": {
                    "type": "string",
                    "description": "One-sentence explanation of why this Output is needed for the user's task.",
                },
            },
            "required": ["output_id"],
            "additionalProperties": False,
        },
    },
]


def send_response(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def call_backend(action: str, payload: dict) -> dict:
    full = {**payload, "parent_session_id": PARENT_SESSION_ID}
    body = json.dumps(full).encode()
    headers = {"Content-Type": "application/json"}
    if BACKEND_AUTH:
        headers["Authorization"] = f"Bearer {BACKEND_AUTH}"
    req = urllib.request.Request(
        f"{BACKEND_URL}/{action}",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else str(e)
        return {"error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"error": str(e)}


def format_outputs(outputs: list[dict], heading: str = "") -> str:
    if not outputs:
        return ""
    lines = []
    if heading:
        lines.append(heading)
    for o in outputs:
        oid = o.get("id", "")
        name = o.get("name", "")
        desc = o.get("description", "") or "no description"
        status = o.get("status", "available")
        used = o.get("use_count", 0)
        used_hint = f" (used {used}×)" if used else ""
        lines.append(f"- `{oid}` **{name}** [{status}]{used_hint} — {desc}")
    return "\n".join(lines)


def handle_tool_call(tool_name: str, arguments: dict) -> dict:
    if tool_name == "OutputList":
        result = call_backend("list", {})
        if "error" in result:
            return {"content": [{"type": "text", "text": f"Error: {result['error']}"}], "isError": True}
        active = result.get("active", [])
        available = result.get("available", [])
        if not active and not available:
            return {"content": [{"type": "text", "text": "No Outputs / Views are defined yet. Use the App Builder mode to create one."}]}
        parts = []
        if active:
            parts.append(format_outputs(active, "Active (full schema in context, RenderOutput can use these now):"))
        if available:
            parts.append(format_outputs(available, "Available (call OutputActivate to load schema):"))
        return {"content": [{"type": "text", "text": "\n\n".join(parts)}]}

    if tool_name == "OutputSearch":
        query = arguments.get("query", "")
        if not query:
            return {"content": [{"type": "text", "text": "Error: query is required"}], "isError": True}
        result = call_backend("search", {"query": query})
        if "error" in result:
            return {"content": [{"type": "text", "text": f"Error: {result['error']}"}], "isError": True}
        matches = result.get("matches", [])
        if not matches:
            return {"content": [{"type": "text", "text": f"No Outputs matched '{query}'. Try OutputList to see everything available."}]}
        body = format_outputs(matches, f"Top matches for '{query}':")
        body += "\n\nNext step: call OutputActivate(output_id) to pin the schema."
        return {"content": [{"type": "text", "text": body}]}

    if tool_name == "OutputActivate":
        output_id = arguments.get("output_id", "")
        reason = arguments.get("reason", "")
        if not output_id:
            return {"content": [{"type": "text", "text": "Error: output_id is required"}], "isError": True}
        result = call_backend("activate", {"output_id": output_id, "reason": reason})
        if "error" in result:
            return {"content": [{"type": "text", "text": f"Error: {result['error']}"}], "isError": True}
        if result.get("status") == "unknown_output":
            available = result.get("available", [])
            return {
                "content": [{
                    "type": "text",
                    "text": (
                        f"Unknown Output id '{output_id}'. Valid options: "
                        + ", ".join(f"`{o}`" for o in available)
                        + ". Call OutputList for full descriptions."
                    ),
                }],
                "isError": True,
            }
        if result.get("status") == "already_active":
            return {"content": [{"type": "text", "text": f"`{output_id}` is already active for this session — its schema is in context now, RenderOutput can use it."}]}
        if result.get("status") == "activated":
            return {
                "content": [{
                    "type": "text",
                    "text": (
                        f"Activated Output `{output_id}`. Its full input_schema "
                        f"will be in context on the NEXT turn. End this turn now "
                        f"and call RenderOutput with the activated id."
                    ),
                }],
            }
        return {"content": [{"type": "text", "text": f"Unexpected response: {json.dumps(result)}"}], "isError": True}

    return {"content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}], "isError": True}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = msg.get("method")
        id_ = msg.get("id")
        params = msg.get("params", {})

        if method == "initialize":
            send_response(id_, {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "openswarm-outputs-meta", "version": "1.0.0"},
            })
        elif method == "notifications/initialized":
            pass
        elif method == "tools/list":
            send_response(id_, {"tools": TOOLS})
        elif method == "tools/call":
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})
            try:
                result = handle_tool_call(tool_name, arguments)
                send_response(id_, result)
            except Exception as e:
                send_response(id_, error={"code": -32000, "message": str(e)})
        elif method == "resources/list":
            send_response(id_, {"resources": []})
        elif method == "prompts/list":
            send_response(id_, {"prompts": []})
        elif id_ is not None:
            send_response(id_, error={"code": -32601, "message": f"Method not found: {method}"})


if __name__ == "__main__":
    main()
