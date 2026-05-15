import React, { useEffect, useRef } from 'react';
import { useStreamingMessage } from '@/shared/state/streamingSlice';
import MessageBubble from './MessageBubble';
import ToolCallBubble from './ToolCallBubble';

interface Props {
  sessionId: string;
  activeBranchId: string;
  turnLabel?: string | null;
  // Called when the streamed content grows so the host scroll container
  // can stick to the bottom. We pass a callback instead of doing the
  // scroll math here so AgentChat keeps ownership of its scroll state
  // (isAtBottomRef etc.). The callback is invoked from a RAF, so it's
  // safe to do DOM reads/writes inside.
  onStreamGrew?: () => void;
}

// Leaf component that subscribes to the streaming entry for a single
// session and renders the appropriate bubble. Isolating this in its own
// component is what keeps AgentChat from re-rendering on every painted
// character. AgentChat only knows whether a stream exists (boolean
// selector elsewhere), not the per-character content. StreamingBubble
// itself does re-render at the streaming rate, but it has no children
// beyond a MessageBubble/ToolCallBubble, so React reconciliation stays
// local and cheap.
const StreamingBubble: React.FC<Props> = ({ sessionId, activeBranchId, turnLabel, onStreamGrew }) => {
  const streamingMessage = useStreamingMessage(sessionId);
  // Fire onStreamGrew once per render (i.e. per delta) on a RAF so the
  // host can scroll if it wants to. RAF coalesces multiple deltas in
  // the same frame into one host call. The ref-callback keeps the
  // useEffect dep array minimal: we don't want to re-run effects on
  // every callback identity change from the parent.
  const onGrewRef = useRef(onStreamGrew);
  onGrewRef.current = onStreamGrew;
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!streamingMessage) return;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onGrewRef.current?.();
    });
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  });
  if (!streamingMessage) return null;

  if (streamingMessage.role === 'tool_call') {
    return (
      <ToolCallBubble
        key={`streaming-${streamingMessage.id}`}
        isStreaming
        isPending
        sessionId={sessionId}
        call={{
          id: streamingMessage.id,
          role: 'tool_call',
          content: { tool: streamingMessage.tool_name || '', input: streamingMessage.content },
          timestamp: new Date().toISOString(),
          branch_id: activeBranchId,
          parent_id: null,
        }}
      />
    );
  }

  return (
    <MessageBubble
      key={`streaming-${streamingMessage.id}`}
      isStreaming
      dynamicTurnLabel={turnLabel}
      message={{
        id: streamingMessage.id,
        role: streamingMessage.role,
        content: streamingMessage.content,
        timestamp: new Date().toISOString(),
        branch_id: activeBranchId,
        parent_id: null,
      }}
    />
  );
};

export default StreamingBubble;
