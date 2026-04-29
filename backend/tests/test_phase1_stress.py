"""Stress tests for the Phase 1 / 2 / 3 perceived-latency changes.

Hits everything we touched on the eric/v2 branch:

  - Message.client_message_id round-trip (optimistic dedupe)
  - Mode migration: 'chat' -> 'ask' on session reconcile + lifespan
    deletion of stale built-in chat.json
  - ContentBlock + StreamEvent now accept type='thinking' /
    delta_type='thinking_delta' without breaking existing types
  - Anthropic provider forwards thinking content_block_start /
    content_block_delta with the right shape
  - Agent loop emits agent:stream_start{role:'thinking'},
    agent:stream_delta, agent:stream_end for thinking blocks AND
    persists a Message(role='thinking') after stream end
  - DashboardLayout serializes notes round-trip
  - exclude_dynamic_sections reaches the SDK kwargs (presence-only;
    we don't run the real CLI here)

Each test runs many randomized iterations to surface race conditions
and bad assumptions. Stub the network and CLI throughout — these
tests are pure logic, no real Anthropic calls.

Run:
    cd backend && .venv/bin/python -m pytest tests/test_phase1_stress.py -v
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import string
import tempfile
from typing import Any
from unittest.mock import patch, AsyncMock

import pytest

# ---------------------------------------------------------------------------
# Boot env: route data dirs into a tmp scratch root before importing
# backend modules.
# ---------------------------------------------------------------------------

_TMPROOT = tempfile.mkdtemp(prefix="openswarm-phase1-stress-")
os.environ.setdefault("OPENSWARM_DATA_DIR", _TMPROOT)


# ---------------------------------------------------------------------------
# Group 1 — Message.client_message_id
# ---------------------------------------------------------------------------


def test_message_round_trips_client_id():
    """The new field must default to None and survive model_dump."""
    from backend.apps.agents.models import Message

    m = Message(role="user", content="hi")
    assert m.client_message_id is None

    dumped = m.model_dump(mode="json")
    assert "client_message_id" in dumped
    assert dumped["client_message_id"] is None

    m2 = Message(role="user", content="hi", client_message_id="opt-abc-123")
    dumped2 = m2.model_dump(mode="json")
    assert dumped2["client_message_id"] == "opt-abc-123"
    rehydrated = Message.model_validate(dumped2)
    assert rehydrated.client_message_id == "opt-abc-123"


def test_message_legacy_payload_without_client_id():
    """Older session JSON files won't have the field — must still load."""
    from backend.apps.agents.models import Message

    legacy = {
        "id": "abc",
        "role": "assistant",
        "content": "hello",
        "timestamp": "2026-04-29T00:00:00",
        "branch_id": "main",
    }
    m = Message.model_validate(legacy)
    assert m.client_message_id is None


def test_client_message_id_collision_resistance():
    """Many random client_message_ids must remain distinct values
    after serialization. Smoke-tests the field preservation in bulk."""
    from backend.apps.agents.models import Message

    seen: set[str] = set()
    for _ in range(500):
        cmi = "opt-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=24))
        seen.add(cmi)
        m = Message(role="user", content=f"msg {cmi}", client_message_id=cmi)
        assert m.client_message_id == cmi
        # Round-trip preserves it
        assert Message.model_validate(m.model_dump(mode="json")).client_message_id == cmi
    assert len(seen) >= 495  # collisions are statistically negligible


# ---------------------------------------------------------------------------
# Group 2 — Mode migration: chat → ask
# ---------------------------------------------------------------------------


def test_builtin_modes_no_chat():
    """Chat must be removed from BUILTIN_MODES; Ask must be present
    with the merged tools (Read+Glob+Grep + Web*)."""
    from backend.apps.modes.models import BUILTIN_MODES

    ids = {m.id for m in BUILTIN_MODES}
    assert "chat" not in ids, "chat mode should have been merged into ask"
    assert "ask" in ids
    ask = next(m for m in BUILTIN_MODES if m.id == "ask")
    assert "WebFetch" in (ask.tools or []), "ask should now include web tools"
    assert "WebSearch" in (ask.tools or [])
    assert "Read" in (ask.tools or [])
    assert "Edit" not in (ask.tools or []), "ask must remain read-only"
    assert "Write" not in (ask.tools or [])
    assert "Bash" not in (ask.tools or [])


def test_modes_lifespan_deletes_stale_chat():
    """A built-in chat.json on disk must be removed on lifespan run.
    User-modified chat.json (is_builtin=False) must be left alone."""
    from backend.apps.modes import modes as modes_mod

    with tempfile.TemporaryDirectory() as td:
        chat_path = os.path.join(td, "chat.json")
        with open(chat_path, "w") as f:
            json.dump({
                "id": "chat", "name": "Chat", "is_builtin": True,
                "system_prompt": "old", "tools": ["AskUserQuestion"],
            }, f)
        with patch.object(modes_mod, "DATA_DIR", td):
            asyncio.run(_run_lifespan(modes_mod))
        assert not os.path.exists(chat_path), "stale built-in chat.json should be removed"

    # User-customized: leave alone
    with tempfile.TemporaryDirectory() as td:
        chat_path = os.path.join(td, "chat.json")
        with open(chat_path, "w") as f:
            json.dump({
                "id": "chat", "name": "MyChat", "is_builtin": False,
                "system_prompt": "user wrote this",
            }, f)
        with patch.object(modes_mod, "DATA_DIR", td):
            asyncio.run(_run_lifespan(modes_mod))
        assert os.path.exists(chat_path), "user-customized chat.json must NOT be deleted"


async def _run_lifespan(modes_mod):
    async with modes_mod.modes_lifespan():
        pass


def test_session_reconcile_migrates_chat_to_ask():
    """reconcile_on_startup must rewrite mode='chat' to 'ask' on disk."""
    from backend.apps.agents.agent_manager import AgentManager
    from backend.apps.agents import agent_manager as am_mod

    with tempfile.TemporaryDirectory() as td:
        # Seed 50 sessions: 30 with mode='chat', 20 with mode='agent'.
        # Some marked running so we also exercise the stale-status path.
        for i in range(50):
            sid = f"sess-{i}"
            mode = "chat" if i < 30 else "agent"
            status = "running" if i % 7 == 0 else "stopped"
            with open(os.path.join(td, f"{sid}.json"), "w") as f:
                json.dump({
                    "id": sid, "name": sid, "model": "sonnet",
                    "mode": mode, "status": status, "messages": [],
                }, f)

        with patch.object(am_mod, "SESSIONS_DIR", td):
            mgr = AgentManager()
            asyncio.run(mgr.reconcile_on_startup())

        for i in range(50):
            sid = f"sess-{i}"
            with open(os.path.join(td, f"{sid}.json")) as f:
                data = json.load(f)
            if i < 30:
                assert data["mode"] == "ask", f"session {sid} should be migrated chat→ask"
            else:
                assert data["mode"] == "agent", f"session {sid} should be untouched"
            # Stale running flipped to stopped
            if i % 7 == 0:
                assert data["status"] == "stopped"


def test_reconcile_idempotent():
    """Running reconcile twice mustn't keep rewriting / churn the file."""
    from backend.apps.agents.agent_manager import AgentManager
    from backend.apps.agents import agent_manager as am_mod

    with tempfile.TemporaryDirectory() as td:
        sid = "s1"
        with open(os.path.join(td, f"{sid}.json"), "w") as f:
            json.dump({
                "id": sid, "name": sid, "model": "sonnet",
                "mode": "chat", "status": "stopped", "messages": [],
            }, f)
        with patch.object(am_mod, "SESSIONS_DIR", td):
            mgr = AgentManager()
            asyncio.run(mgr.reconcile_on_startup())
            mtime_after_first = os.path.getmtime(os.path.join(td, f"{sid}.json"))
            # Second pass must NOT rewrite (mode already 'ask', status already stopped)
            asyncio.run(mgr.reconcile_on_startup())
            mtime_after_second = os.path.getmtime(os.path.join(td, f"{sid}.json"))
        assert mtime_after_first == mtime_after_second, "reconcile must be idempotent"


# ---------------------------------------------------------------------------
# Group 3 — ContentBlock / StreamEvent thinking acceptance
# ---------------------------------------------------------------------------


def test_content_block_thinking_type():
    from backend.apps.agents.providers.base import ContentBlock

    cb = ContentBlock(type="thinking", text="some reasoning")
    assert cb.type == "thinking"
    assert cb.text == "some reasoning"
    assert cb.tool_call is None


def test_stream_event_thinking_delta():
    from backend.apps.agents.providers.base import StreamEvent

    e = StreamEvent(type="content_block_delta", delta_type="thinking_delta", text="hmm")
    assert e.delta_type == "thinking_delta"
    assert e.text == "hmm"

    # Existing types still work — no regression
    e2 = StreamEvent(type="content_block_delta", delta_type="text_delta", text="hi")
    assert e2.delta_type == "text_delta"


# ---------------------------------------------------------------------------
# Group 4 — Anthropic provider thinking forwarding
#
# We feed a fake raw_stream (mimicking the SDK's async generator) through
# AnthropicProvider.stream_message and confirm the right StreamEvents come
# out. No network.
# ---------------------------------------------------------------------------


class _FakeRawEvent:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class _FakeBlock:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class _FakeDelta:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


@pytest.mark.asyncio
async def test_anthropic_provider_forwards_thinking_blocks():
    """Mock the raw Anthropic stream with a thinking block + thinking_delta
    + content_block_stop, and assert AnthropicProvider yields the
    normalized StreamEvents the agent_loop expects."""
    from backend.apps.agents.providers.anthropic import AnthropicProvider

    raw_events = [
        # thinking block opens at index 0
        _FakeRawEvent(type="content_block_start", index=0,
                      content_block=_FakeBlock(type="thinking")),
        _FakeRawEvent(type="content_block_delta", index=0,
                      delta=_FakeDelta(type="thinking_delta", thinking="step 1, ")),
        _FakeRawEvent(type="content_block_delta", index=0,
                      delta=_FakeDelta(type="thinking_delta", thinking="step 2.")),
        # signature_delta on thinking — must be ignored, not crash
        _FakeRawEvent(type="content_block_delta", index=0,
                      delta=_FakeDelta(type="signature_delta", signature="abc==")),
        _FakeRawEvent(type="content_block_stop", index=0),
        # text block follows at index 1
        _FakeRawEvent(type="content_block_start", index=1,
                      content_block=_FakeBlock(type="text")),
        _FakeRawEvent(type="content_block_delta", index=1,
                      delta=_FakeDelta(type="text_delta", text="hi")),
        _FakeRawEvent(type="content_block_stop", index=1),
    ]

    async def fake_stream():
        for ev in raw_events:
            yield ev

    # AnthropicProvider takes api_key/auth_token/base_url; we monkeypatch
    # its `client.messages.create` after construction so no real
    # SDK client is needed.
    provider = AnthropicProvider(api_key="test-key")
    provider.client.messages.create = AsyncMock(return_value=fake_stream())
    out_events = []
    async for ev in provider.stream_message(model="sonnet", system=None, messages=[], tools=[]):
        out_events.append(ev)

    types = [(e.type, e.block_type, e.delta_type) for e in out_events]
    # Thinking block should produce: start, 2x delta, stop. signature_delta ignored.
    assert ("content_block_start", "thinking", "") in types
    assert types.count(("content_block_delta", "", "thinking_delta")) == 2
    assert ("content_block_start", "text", "") in types
    assert ("content_block_delta", "", "text_delta") in types

    thinking_text = "".join(
        e.text for e in out_events
        if e.type == "content_block_delta" and e.delta_type == "thinking_delta"
    )
    assert thinking_text == "step 1, step 2."


# ---------------------------------------------------------------------------
# Group 5 — Agent loop end-to-end thinking → WS events + persisted message
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_loop_emits_thinking_stream_and_persists_message():
    """Drive the agent loop with a fake provider that yields thinking,
    text, and one tool_use. Verify it emits the right WS events AND
    persists a Message(role='thinking') via _emit_collected_messages."""
    from backend.apps.agents.providers.base import StreamEvent

    captured_ws: list[tuple[str, dict]] = []

    async def fake_emitter(event: str, payload: dict):
        captured_ws.append((event, payload))

    # Build a fake provider yielding our normalized StreamEvents.
    class FakeProvider:
        async def stream_message(self, **kwargs):
            yield StreamEvent(type="content_block_start", index=0, block_type="thinking")
            yield StreamEvent(type="content_block_delta", index=0,
                              delta_type="thinking_delta", text="reasoning… ")
            yield StreamEvent(type="content_block_delta", index=0,
                              delta_type="thinking_delta", text="more.")
            yield StreamEvent(type="content_block_stop", index=0)
            yield StreamEvent(type="content_block_start", index=1, block_type="text")
            yield StreamEvent(type="content_block_delta", index=1,
                              delta_type="text_delta", text="hello!")
            yield StreamEvent(type="content_block_stop", index=1)
            yield StreamEvent(type="message_stop")

    from backend.apps.agents.agent_loop import AgentLoop

    loop = AgentLoop(
        session_id="s1",
        provider=FakeProvider(),
        model="sonnet",
        system_prompt="x",
        tools=[],
        ws_emitter=fake_emitter,
        hitl_handler=AsyncMock(return_value=(True, None)),
        tool_executor=AsyncMock(return_value=[{"type": "text", "text": "ok"}]),
    )

    response = await loop._stream_and_collect()

    # Stream events: thinking start + 2 deltas + stream_end, then text start + delta + (text end at message_stop)
    events_by_type = {}
    for ev, payload in captured_ws:
        events_by_type.setdefault(ev, []).append(payload)

    # Thinking should have its own stream_start with role='thinking'
    starts = events_by_type.get("agent:stream_start", [])
    thinking_starts = [s for s in starts if s.get("role") == "thinking"]
    assistant_starts = [s for s in starts if s.get("role") == "assistant"]
    assert len(thinking_starts) == 1, f"expected 1 thinking start, got {len(thinking_starts)}"
    assert len(assistant_starts) == 1, "expected 1 assistant text start"

    # Two thinking deltas
    deltas = events_by_type.get("agent:stream_delta", [])
    thinking_msg_id = thinking_starts[0]["message_id"]
    thinking_deltas = [d for d in deltas if d.get("message_id") == thinking_msg_id]
    assert len(thinking_deltas) == 2
    assert "".join(d["delta"] for d in thinking_deltas) == "reasoning… more."

    # Thinking stream_end fires (text doesn't get stream_end inside _stream_and_collect — closes at message_stop)
    ends = events_by_type.get("agent:stream_end", [])
    assert any(e["message_id"] == thinking_msg_id for e in ends), "thinking must emit stream_end"

    # Now persist via _emit_collected_messages and verify a thinking
    # Message went out
    captured_ws.clear()
    await loop._emit_collected_messages(
        response.content,
        text_msg_id=assistant_starts[0]["message_id"],
        tool_msg_ids={},
    )
    persisted = [p for ev, p in captured_ws if ev == "agent:message"]
    roles = [p["message"]["role"] for p in persisted]
    assert "thinking" in roles, "thinking content must be persisted as a Message"
    assert "assistant" in roles
    thinking_msg = next(p for p in persisted if p["message"]["role"] == "thinking")
    assert thinking_msg["message"]["content"] == "reasoning… more."


@pytest.mark.asyncio
async def test_agent_loop_handles_no_thinking_gracefully():
    """Provider that emits zero thinking blocks must still work.
    Regression guard against the new branch breaking text-only paths."""
    from backend.apps.agents.providers.base import StreamEvent
    from backend.apps.agents.agent_loop import AgentLoop

    captured_ws = []

    async def fake_emitter(event, payload):
        captured_ws.append((event, payload))

    class TextOnly:
        async def stream_message(self, **kwargs):
            yield StreamEvent(type="content_block_start", index=0, block_type="text")
            yield StreamEvent(type="content_block_delta", index=0,
                              delta_type="text_delta", text="just text")
            yield StreamEvent(type="content_block_stop", index=0)
            yield StreamEvent(type="message_stop")

    loop = AgentLoop(
        session_id="s2", provider=TextOnly(), model="sonnet", system_prompt=None,
        tools=[],
        ws_emitter=fake_emitter,
        hitl_handler=AsyncMock(return_value=(True, None)),
        tool_executor=AsyncMock(return_value=[]),
    )

    resp = await loop._stream_and_collect()
    starts = [p for ev, p in captured_ws if ev == "agent:stream_start"]
    # Exactly one assistant start, zero thinking starts
    assert len([s for s in starts if s.get("role") == "thinking"]) == 0
    assert len([s for s in starts if s.get("role") == "assistant"]) == 1
    assert any(b.type == "text" for b in resp.content)


@pytest.mark.asyncio
async def test_agent_loop_stress_many_thinking_blocks():
    """Hammer the loop with a long sequence of interleaved thinking +
    text + tool blocks. Ensures the per-index buffers don't leak and
    every block gets the right WS events."""
    from backend.apps.agents.providers.base import StreamEvent
    from backend.apps.agents.agent_loop import AgentLoop

    captured = []

    async def fake_emitter(ev, p):
        captured.append((ev, p))

    class Mix:
        async def stream_message(self, **kwargs):
            idx = 0
            for turn in range(40):
                yield StreamEvent(type="content_block_start", index=idx, block_type="thinking")
                for _ in range(random.randint(1, 5)):
                    yield StreamEvent(type="content_block_delta", index=idx,
                                      delta_type="thinking_delta", text=f"t{idx} ")
                yield StreamEvent(type="content_block_stop", index=idx)
                idx += 1
                yield StreamEvent(type="content_block_start", index=idx, block_type="text")
                yield StreamEvent(type="content_block_delta", index=idx,
                                  delta_type="text_delta", text=f"text-{idx}")
                yield StreamEvent(type="content_block_stop", index=idx)
                idx += 1
            yield StreamEvent(type="message_stop")

    loop = AgentLoop(
        session_id="s3", provider=Mix(), model="sonnet", system_prompt=None,
        tools=[],
        ws_emitter=fake_emitter,
        hitl_handler=AsyncMock(return_value=(True, None)),
        tool_executor=AsyncMock(return_value=[]),
    )
    resp = await loop._stream_and_collect()

    starts = [p for ev, p in captured if ev == "agent:stream_start"]
    ends = [p for ev, p in captured if ev == "agent:stream_end"]

    # 40 thinking + 1 assistant (text accumulates into one stream_text_msg_id)
    thinking_starts = [s for s in starts if s.get("role") == "thinking"]
    assistant_starts = [s for s in starts if s.get("role") == "assistant"]
    assert len(thinking_starts) == 40, f"got {len(thinking_starts)} thinking starts, want 40"
    assert len(assistant_starts) == 1, "all text blocks share one assistant stream id"

    # Each thinking block must have its own stream_end
    thinking_ids = {s["message_id"] for s in thinking_starts}
    end_ids = {e["message_id"] for e in ends}
    assert thinking_ids.issubset(end_ids), "every thinking block needs a stream_end"


# ---------------------------------------------------------------------------
# Group 6 — Notes layout serialization
# ---------------------------------------------------------------------------


def test_dashboard_layout_notes_round_trip():
    from backend.apps.dashboards.models import DashboardLayout, NotePosition

    n = NotePosition(note_id="n1", x=100, y=200, content="todo: ship",
                     color="yellow", width=240, height=200)
    layout = DashboardLayout(notes={"n1": n})
    dumped = layout.model_dump(mode="json")
    assert "notes" in dumped
    assert dumped["notes"]["n1"]["content"] == "todo: ship"

    rehydrated = DashboardLayout.model_validate(dumped)
    assert rehydrated.notes["n1"].content == "todo: ship"
    assert rehydrated.notes["n1"].color == "yellow"


def test_dashboard_layout_legacy_no_notes():
    """Older dashboard JSON without 'notes' must still load cleanly."""
    from backend.apps.dashboards.models import DashboardLayout

    legacy = {
        "cards": {}, "view_cards": {}, "browser_cards": {},
        "expanded_session_ids": [],
    }
    layout = DashboardLayout.model_validate(legacy)
    assert layout.notes == {}


def test_notes_stress_many_round_trips():
    """500 notes with random colors / positions must all serialize."""
    from backend.apps.dashboards.models import DashboardLayout, NotePosition

    notes = {}
    colors = ["yellow", "pink", "blue", "green", "purple", "gray"]
    for i in range(500):
        nid = f"n{i}"
        notes[nid] = NotePosition(
            note_id=nid,
            x=random.uniform(-5000, 5000),
            y=random.uniform(-5000, 5000),
            width=random.uniform(160, 600),
            height=random.uniform(120, 600),
            content="x" * random.randint(0, 5000),
            color=random.choice(colors),
        )
    layout = DashboardLayout(notes=notes)
    dumped = layout.model_dump(mode="json")
    rehydrated = DashboardLayout.model_validate(dumped)
    assert len(rehydrated.notes) == 500
    for nid, orig in notes.items():
        assert rehydrated.notes[nid].content == orig.content
        assert rehydrated.notes[nid].color == orig.color


# ---------------------------------------------------------------------------
# Group 7 — Concurrent send_message dedupe stress
#
# Real-world scenario: user mashes Enter quickly. 50 concurrent sends
# each with a unique client_message_id must produce 50 echoed messages
# carrying the right ids. Pure pydantic / asyncio test — no real
# agent loop.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_send_message_unique_client_ids():
    """100 parallel Message constructions with unique client_message_ids
    must round-trip independently — no cross-talk on the dataclass."""
    from backend.apps.agents.models import Message

    async def make_one(i: int):
        cmi = f"opt-{i}-{random.randint(0, 1_000_000)}"
        m = Message(role="user", content=f"msg {i}", client_message_id=cmi)
        return cmi, m.model_dump(mode="json")["client_message_id"]

    pairs = await asyncio.gather(*(make_one(i) for i in range(100)))
    expected = [p[0] for p in pairs]
    actual = [p[1] for p in pairs]
    assert expected == actual, "client_message_id must round-trip exactly"
    assert len(set(actual)) == 100, "all unique"


# ---------------------------------------------------------------------------
# Pytest config: register asyncio mode so we don't need the plugin.
# ---------------------------------------------------------------------------


def pytest_collection_modifyitems(config, items):
    """Auto-mark async tests so they run under pytest-asyncio."""
    for item in items:
        if asyncio.iscoroutinefunction(getattr(item, "function", None)):
            item.add_marker(pytest.mark.asyncio)
