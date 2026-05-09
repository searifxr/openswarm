// Window blur/focus tracking — analytics signal for "user switched to
// another app" (temp-churn measurement).
//
// Wires the IPC channel that electron/main.js fires on the BrowserWindow's
// blur/focus events into the existing `report()` analytics pipeline. Each
// blur emits `app focus_lost` with the elapsed-ms-since-last-focus, and
// each focus emits `app focus_gained` with elapsed-ms-since-last-blur.
//
// Together these answer: how often do users leave OpenSwarm mid-session,
// for how long, and at what cadence?
//
// No-op in browser/web context where window.openswarm is undefined.

import { useEffect } from 'react';
import { report } from '@/shared/serviceClient';

interface FocusPayload {
  kind: 'blur' | 'focus';
  ts: number;
}

interface OpenSwarmAPI {
  onWindowFocus?: (cb: (payload: FocusPayload) => void) => () => void;
}

export function useWindowFocus(): void {
  useEffect(() => {
    const api = (window as unknown as { openswarm?: OpenSwarmAPI }).openswarm;
    if (!api?.onWindowFocus) return;

    let lastBlurTs: number | null = null;
    let lastFocusTs: number | null = null;

    const unsubscribe = api.onWindowFocus(({ kind, ts }) => {
      if (kind === 'blur') {
        const elapsedMsSinceFocus = lastFocusTs !== null ? ts - lastFocusTs : null;
        report('app', 'focus_lost', {
          ms_since_last_focus: elapsedMsSinceFocus,
        });
        lastBlurTs = ts;
      } else {
        const elapsedMsAway = lastBlurTs !== null ? ts - lastBlurTs : null;
        report('app', 'focus_gained', {
          ms_away: elapsedMsAway,
        });
        lastFocusTs = ts;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
