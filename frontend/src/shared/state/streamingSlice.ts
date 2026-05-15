import { createSlice, PayloadAction, createAction } from '@reduxjs/toolkit';

// Action type strings for cross-slice listening: we react to agentsSlice
// events (addMessage, editMessage, etc.) by clearing the streaming entry,
// matching the old in-place behavior. Using createAction with the same
// name lets streamingSlice's extraReducers catch the dispatch even though
// the action itself is owned by agentsSlice.
const addMessageAction = createAction<{ sessionId: string; message: { id: string } }>('agents/addMessage');
const editMessageFulfilled = createAction<{ sessionId: string }>('agents/editMessage/fulfilled');
const clearSessionMessagesAction = createAction<string>('agents/clearSessionMessages');
const closeSessionFromWsAction = createAction<{ id: string }>('agents/closeSessionFromWs');
const removeSessionAction = createAction<string>('agents/removeSession');
// stopAgent thunk's fulfilled action carries the sessionId as payload.
// Listening here lets us drop the streaming entry the moment the user
// stops a running agent, matching the previous in-place behavior.
const stopAgentFulfilledAction = createAction<string>('agents/stopAgent/fulfilled');

// Streaming-message state lives in its own slice (separate from agents/
// sessions) so that the high-frequency mutation of streamingMessage.content
// on every painted character doesn't bubble up through the sessions dict
// reference. Previously each painted character changed `state.agents.sessions`
// via Immer, causing every component subscribed to `state.agents.sessions`
// (Dashboard.tsx in particular: 30 useEffects, many selectors) to
// re-render at 30Hz × N streaming agents. Moving this out keeps the
// sessions dict stable during streaming; only structural events (start,
// end, status change, new message) mutate it now.

export interface StreamingMessage {
  id: string;
  role: 'assistant' | 'tool_call' | 'thinking';
  content: string;
  tool_name?: string;
}

interface StreamingState {
  // Keyed by sessionId. Map semantics: an entry exists iff that session
  // currently has an in-flight streaming message; it's removed on
  // stream_end. Use selectStreamingMessage(sessionId) to read.
  bySession: Record<string, StreamingMessage>;
}

const initialState: StreamingState = {
  bySession: {},
};

const streamingSlice = createSlice({
  name: 'streaming',
  initialState,
  reducers: {
    streamStart(
      state,
      action: PayloadAction<{ sessionId: string; messageId: string; role: StreamingMessage['role']; toolName?: string }>,
    ) {
      state.bySession[action.payload.sessionId] = {
        id: action.payload.messageId,
        role: action.payload.role,
        content: '',
        tool_name: action.payload.toolName,
      };
    },
    streamDelta(
      state,
      action: PayloadAction<{ sessionId: string; messageId: string; delta: string }>,
    ) {
      const entry = state.bySession[action.payload.sessionId];
      if (entry && entry.id === action.payload.messageId) {
        entry.content += action.payload.delta;
      }
    },
    streamEnd(
      state,
      action: PayloadAction<{ sessionId: string; messageId: string }>,
    ) {
      const entry = state.bySession[action.payload.sessionId];
      if (entry && entry.id === action.payload.messageId) {
        delete state.bySession[action.payload.sessionId];
      }
    },
    // Used when a session is fully closed/removed so we don't leak a
    // stuck streaming entry for a session that no longer exists.
    clearStreamingForSession(state, action: PayloadAction<string>) {
      delete state.bySession[action.payload];
    },
  },
  extraReducers: (builder) => {
    // When a final message lands for a session, clear the streaming
    // entry if it matches (the streaming bubble in the UI was acting as
    // a placeholder; now the real message takes over). Matches the
    // original behavior that lived in agentsSlice.addMessage.
    builder.addCase(addMessageAction, (state, action) => {
      const entry = state.bySession[action.payload.sessionId];
      if (entry && entry.id === action.payload.message.id) {
        delete state.bySession[action.payload.sessionId];
      }
    });
    // Edit / clear / close / remove all wipe any in-flight streaming
    // bubble regardless of id match: the session's been mutated.
    builder.addCase(editMessageFulfilled, (state, action) => {
      delete state.bySession[action.payload.sessionId];
    });
    builder.addCase(clearSessionMessagesAction, (state, action) => {
      delete state.bySession[action.payload];
    });
    builder.addCase(closeSessionFromWsAction, (state, action) => {
      delete state.bySession[action.payload.id];
    });
    builder.addCase(removeSessionAction, (state, action) => {
      delete state.bySession[action.payload];
    });
    builder.addCase(stopAgentFulfilledAction, (state, action) => {
      delete state.bySession[action.payload];
    });
  },
});

export const { streamStart, streamDelta, streamEnd, clearStreamingForSession } = streamingSlice.actions;
export default streamingSlice.reducer;

// Reader hook. Each call subscribes only to that one session's streaming
// entry, so unrelated agents' deltas don't trigger re-renders. Returns
// null when no stream is active for the session.
import { useAppSelector } from '@/shared/hooks';
export function useStreamingMessage(sessionId: string | null | undefined) {
  return useAppSelector((s) => sessionId ? s.streaming.bySession[sessionId] ?? null : null);
}
