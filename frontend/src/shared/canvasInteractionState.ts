// Plain-JS shared ref (NOT React state) for "is the user currently
// interacting with the canvas" (pan/drag/wheel/zoom). Read on hot paths
// like AgentCard's ResizeObserver to suppress expensive work during the
// gesture. Setting/clearing the ref does NOT trigger any React re-renders.
//
// Why this pattern instead of Redux or context: ResizeObserver callbacks
// fire dozens of times per second during streaming. We want them to bail
// in O(1) without a subscription that itself has overhead. A module-level
// mutable holder + a one-shot "interaction ended" event meets both.

let _isPanning = false;

const listeners: Set<() => void> = new Set();

export function isCanvasInteractionActive(): boolean {
  return _isPanning;
}

export function setCanvasInteractionActive(active: boolean) {
  if (_isPanning === active) return;
  const wasActive = _isPanning;
  _isPanning = active;
  // Fire the end-of-interaction notification so listeners can flush work
  // that was suppressed during the gesture (re-measure heights, dispatch
  // pending state updates, etc.).
  if (wasActive && !active) {
    for (const fn of listeners) {
      try { fn(); } catch (e) { console.warn('[canvas-interaction] listener threw', e); }
    }
  }
}

export function onCanvasInteractionEnd(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
