// Tiny mitt-style event bus for onboarding-v2 advance conditions that
// don't have a natural Redux signal. Each emit site is a one-liner at the
// success path of a feature (browser:spawned at the end of spawnBrowser,
// settings:closed when the modal closes, etc).
//
// Why not Redux for everything: some events (browser navigated, app
// generation milestones) involve backend round-trips and the Redux state
// lags by a tick. Explicit emit at the success callsite is more
// deterministic than observing state.

export type OnboardingEvent =
  | 'browser:spawned'
  | 'browser:navigated'
  | 'settings:closed'
  | 'chat:message_sent'
  | 'app:generation_started'
  | 'app:generation_done'
  | 'skill:installed'
  | 'action:toggled'
  | 'mode:created'
  | 'note:created'
  | 'element_selection:toggled'
  | 'agent:spawned'
  | 'agent:completed'
  | 'agent:attached_to_browser';

type Handler = (...args: unknown[]) => void;

// Replay window — see explanation on once() below. Tight on purpose so
// previous steps' emits can't accidentally satisfy current-step waits;
// the gating below is a stronger guarantee than the time window alone.
const REPLAY_WINDOW_MS = 500;

class OnboardingBus {
  private handlers = new Map<OnboardingEvent, Set<Handler>>();
  // recentEmits stores the timestamp of the most recent emit per event.
  // Used by once() to satisfy a subscription that races a synchronous
  // emit (e.g. AC.click() → handleSend → emit happens BEFORE the next
  // op's wait_user gets to register). Without this, the wait sits idle
  // for its full timeout.
  private recentEmits = new Map<OnboardingEvent, number>();
  // Monotonic gate id. Director bumps this whenever a new step starts;
  // any once() subscriber that registers will only consider replays
  // emitted after that bump. Solves the cross-step contamination case
  // where step 6 emitted chat:message_sent ages ago and step 8's
  // identical wait satisfies on the stale cached timestamp.
  private gateId = 0;
  private gateTs = 0;

  /**
   * Bump the gate. Director calls this at the start of every new step
   * (and at runStep cleanup). All recentEmits become invisible to
   * subsequent once() subscribers — they only match emits that happen
   * AFTER the bump. Also clears the recentEmits map outright as
   * defense-in-depth — the gate alone would suffice but keeping a
   * stale map around for hours is wasteful.
   */
  resetReplayGate(): void {
    this.gateId += 1;
    this.gateTs = Date.now();
    this.recentEmits.clear();
  }

  on(event: OnboardingEvent, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit(event: OnboardingEvent, ...args: unknown[]): void {
    this.recentEmits.set(event, Date.now());
    const set = this.handlers.get(event);
    if (!set) return;
    // Snapshot to avoid mutation during iteration.
    [...set].forEach((h) => {
      try {
        h(...args);
      } catch (err) {
        console.warn('[onboarding] bus handler threw', event, err);
      }
    });
  }

  once(event: OnboardingEvent, handler: Handler): () => void {
    // Replay path: if this exact event was emitted within the last
    // REPLAY_WINDOW_MS *AND* after the most recent gate bump, fire
    // the handler now and don't register at all. The gate check is
    // what prevents stale step-6 emits from satisfying step-8 waits.
    const last = this.recentEmits.get(event);
    if (
      last !== undefined &&
      last > this.gateTs &&
      Date.now() - last <= REPLAY_WINDOW_MS
    ) {
      queueMicrotask(() => {
        try {
          handler();
        } catch (err) {
          console.warn('[onboarding] bus replay handler threw', event, err);
        }
      });
      return () => {};
    }
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
    return off;
  }
}

export const onboardingBus = new OnboardingBus();

// Expose on window in dev for debugging — tests and the browser console
// can poke `window.__OPENSWARM_ONBOARDING_BUS__.emit('browser:spawned')`
// to advance steps without going through real product UI.
if (typeof window !== 'undefined') {
  (window as any).__OPENSWARM_ONBOARDING_BUS__ = onboardingBus;
}
