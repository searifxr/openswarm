// Native (Electron / browser) notifications for agent completion.
//
// We only fire when the document is hidden — the user has switched away —
// since a notification while you're staring at the same window would just
// be noise. Granola/Linear/Raycast all converge on this rule.
//
// Permission is requested lazily on first attempted use; subsequent calls
// no-op gracefully when permission is denied. Click on a notification
// re-focuses the window and emits a custom event the renderer listens for
// to deep-link back to the right session.

const FIRED_RECENTLY = new Set<string>();
const COOLDOWN_MS = 30_000;

let permissionRequested = false;

function ensurePermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  if (!permissionRequested) {
    permissionRequested = true;
    Notification.requestPermission().catch(() => {});
  }
  return 'default';
}

export interface AgentCompletionPayload {
  sessionId: string;
  sessionName: string;
  dashboardId?: string;
  status: 'completed' | 'error';
  bodyExcerpt?: string;
}

export function notifyAgentCompletion(p: AgentCompletionPayload): void {
  if (typeof document === 'undefined') return;
  // Same-window — skip noise. Hidden = tab switched, window minimised, or
  // (in Electron) another BrowserWindow is in front.
  if (!document.hidden) return;
  if (typeof Notification === 'undefined') return;
  const perm = ensurePermission();
  if (perm !== 'granted') return;

  // Per-session debounce — if a sub-agent flips completed→error→completed
  // in quick succession we still only fire one toast.
  const key = `${p.sessionId}:${p.status}`;
  if (FIRED_RECENTLY.has(key)) return;
  FIRED_RECENTLY.add(key);
  setTimeout(() => FIRED_RECENTLY.delete(key), COOLDOWN_MS);

  const title = p.status === 'error'
    ? `${p.sessionName} hit an error`
    : `${p.sessionName} finished`;
  const body = (p.bodyExcerpt || '').slice(0, 140);

  try {
    const n = new Notification(title, {
      body,
      tag: p.sessionId,
      silent: false,
    });
    n.onclick = () => {
      try { window.focus(); } catch {}
      window.dispatchEvent(new CustomEvent('openswarm:notification-click', {
        detail: { sessionId: p.sessionId, dashboardId: p.dashboardId },
      }));
      n.close();
    };
  } catch {
    // Notification API can throw if the page is sandboxed or in a
    // headless harness — fail silently.
  }
}
