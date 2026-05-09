// Module-level signal for the cursor's logical position. Both the
// AgenticCursor component (which renders the arrow) and ACPopup /
// ACMultiChoice (which need to render relative to it) read from here.
//
// Performance contract: the cursor itself is driven by Framer Motion's
// imperative `controls.set`, which doesn't trigger React renders. This
// store exists ONLY so popups can follow during animation. Subscribers
// re-render on every notification, so naive frame-rate notifications
// would re-render the popup 60 times/sec — wasteful since popup
// position barely changes between sub-pixel cursor frames.
//
// We coalesce position writes to ~30fps via rAF and only notify when
// the cursor has moved more than COALESCE_PX. Visibility flips are
// flushed immediately (rare event, user-visible).

import { useSyncExternalStore } from 'react';

interface CursorPos {
  x: number;
  y: number;
  visible: boolean;
}

let state: CursorPos = { x: 0, y: 0, visible: false };
let pendingState: CursorPos | null = null;
const listeners = new Set<() => void>();

// Sub-pixel cursor moves don't change popup position visibly, but they
// still trigger React renders. 1.5px is enough to feel smooth without
// re-rendering on every frame.
const COALESCE_PX = 1.5;
let rafScheduled = false;

function flush() {
  rafScheduled = false;
  if (!pendingState) return;
  state = pendingState;
  pendingState = null;
  listeners.forEach((l) => l());
}

export const cursorStore = {
  get: () => state,
  set(next: Partial<CursorPos>) {
    const merged = { ...(pendingState ?? state), ...next };

    // Visibility transitions bypass coalescing — these are user-visible
    // mounts/unmounts of popups, must flush immediately.
    const visibilityChanged = merged.visible !== state.visible;
    const dx = Math.abs(merged.x - state.x);
    const dy = Math.abs(merged.y - state.y);
    const significantMove = dx >= COALESCE_PX || dy >= COALESCE_PX;

    if (visibilityChanged) {
      state = merged;
      pendingState = null;
      rafScheduled = false;
      listeners.forEach((l) => l());
      return;
    }

    if (!significantMove) {
      // Below threshold: update pending state silently. The next
      // significant move will pick up the latest pending values.
      pendingState = merged;
      return;
    }

    pendingState = merged;
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(flush);
    }
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useCursorPosition(): CursorPos {
  return useSyncExternalStore(
    cursorStore.subscribe,
    cursorStore.get,
    cursorStore.get,
  );
}
