// Single source of truth for "what URL should the preview webview point at?"
//
// New-mode webapp_template workspaces have no root index.html — the live
// preview lives behind the workspace's own Vite dev server, whose port is
// announced by the backend's runtime:status WS frame. Old-mode flat
// workspaces still serve files through the legacy /api/outputs/.../serve/
// endpoints. This hook hides the difference: it attaches to the runtime
// (ref-counted server-side, so multiple subscribers share one process),
// listens for status, and exposes the live frontend_url + new-mode flag.
// Consumers compute their final URL with `pickPreviewUrl()` below.
//
// Used by both ViewEditor (editor tab) and DashboardViewCard (dashboard
// canvas). Earlier each component had its own copy of this effect and
// only the editor had the new-mode logic — that's why dashboard cards
// for webapp_template apps were rendering the literal "File not found
// in output" JSON. One hook now, both consumers stay in sync.

import { useEffect, useRef, useState } from 'react';
import { API_BASE, getAuthToken } from '@/shared/config';

export interface RuntimeLogLine {
  source: 'backend' | 'runtime';
  stream: string;
  text: string;
}

export interface RuntimePreviewState {
  frontendUrl: string | null;
  isNewMode: boolean;
  // True for the first ~400ms after subscribing — gives the runtime WS a
  // chance to send its initial runtime:status frame before consumers
  // decide to render a "Starting preview…" placeholder. Without this
  // gate, dashboard cards flashed the placeholder every remount even
  // when Vite was already up, because frontendUrl resets to null on
  // mount and arrives one tick later.
  isHydrating: boolean;
}

export interface RuntimePreviewOptions {
  // Workspace to attach to. null/undefined → no-op (no spawn, no WS).
  workspaceId: string | null | undefined;
  // Gate the spawn. Lets callers defer paying the runtime cost until
  // the user actually wants the preview (ViewEditor only spawns once
  // the user clicks Preview or Terminal). Dashboard cards default to
  // true since the preview pane is always visible.
  enabled?: boolean;
  // Optional sink for log lines. Editor's terminal panel uses this;
  // dashboard cards don't need it and can omit.
  onLog?: (line: RuntimeLogLine) => void;
}

export function useRuntimePreviewUrl(opts: RuntimePreviewOptions): RuntimePreviewState {
  const { workspaceId, enabled = true, onLog } = opts;
  const [frontendUrl, setFrontendUrl] = useState<string | null>(null);
  const [isNewMode, setIsNewMode] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  // Pin the latest onLog so we don't tear down + respawn the runtime
  // every time the callback identity changes. The effect only depends
  // on workspaceId + enabled.
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setIsHydrating(false);
      return;
    }
    let cancelled = false;
    let ws: WebSocket | null = null;
    setFrontendUrl(null);
    setIsNewMode(false);
    setIsHydrating(true);
    // Drop the hydrating flag after the WS has had time to deliver its
    // initial runtime:status frame. With the backend's 80ms poll
    // interval, status almost always arrives in 20-100ms; 150ms is
    // generous enough that warm starts never flash the booting
    // placeholder, while not making genuinely-cold runtimes wait an
    // extra half second before showing "Starting preview…".
    const hydrationTimer = setTimeout(() => {
      if (!cancelled) setIsHydrating(false);
    }, 150);

    const auth = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${auth}`;

    (async () => {
      try {
        await fetch(`${API_BASE}/outputs/workspace/${workspaceId}/runtime/start`, {
          method: 'POST',
          headers,
        });
      } catch (_) {
        // Spawn errors surface via the log WS. Don't double-report.
      }
      if (cancelled) return;
      try {
        const wsBase = API_BASE.replace(/^http/, 'ws').replace(/\/api$/, '');
        const url = `${wsBase}/ws/outputs/runtime/${workspaceId}/logs?token=${encodeURIComponent(auth || '')}`;
        ws = new WebSocket(url);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.event === 'runtime:status') {
              const fu = msg.data?.frontend_url ?? null;
              setFrontendUrl(fu || null);
              setIsNewMode(!!msg.data?.is_new_mode);
              // Status arrived; hand off to the real ready/booting gate.
              setIsHydrating(false);
            } else if (msg.event === 'runtime:log') {
              const stream = msg.data?.stream || 'stdout';
              const text = msg.data?.text || '';
              const source: RuntimeLogLine['source'] = stream === 'runtime' ? 'runtime' : 'backend';
              onLogRef.current?.({ source, stream, text });
            }
          } catch (_) {
            // Malformed frame; safe to drop.
          }
        };
      } catch (_) {
        // WS construction failed (CSP, bad URL, etc). Caller stays in
        // its "no preview yet" state — same shape as a slow Vite cold start.
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(hydrationTimer);
      try { ws?.close(); } catch (_) {}
      setFrontendUrl(null);
      setIsNewMode(false);
      setIsHydrating(true);
      // detach is ref-counted on the backend — only the last subscriber
      // actually tears down the runtime, the rest are no-ops. We fire
      // and forget; errors here would be transient and don't affect UX.
      fetch(`${API_BASE}/outputs/workspace/${workspaceId}/runtime/stop`, {
        method: 'POST',
        headers,
      }).catch(() => {});
    };
  }, [workspaceId, enabled]);

  return { frontendUrl, isNewMode, isHydrating };
}

export interface PickPreviewUrlOptions {
  workspaceId: string | null | undefined;
  // Legacy fallback URL for old-mode flat workspaces. Pass the URL the
  // component used BEFORE the new-mode split (ViewEditor uses
  // `${SERVE_BASE}/workspace/${ws}/serve/index.html`, dashboard cards
  // use `${SERVE_BASE}/${output_id}/serve/index.html`). When the runtime
  // says we're in new-mode AND Vite is up, we override with frontendUrl.
  legacyUrl: string | undefined;
  frontendUrl: string | null;
  isNewMode: boolean;
}

export interface PickPreviewUrlResult {
  // Final URL the preview should load. `undefined` means "show placeholder
  // instead" — happens when the workspace is new-mode but Vite hasn't
  // bound yet (cold start, npm install in progress, runtime crashed).
  url: string | undefined;
  // True iff we're in new-mode and frontendUrl hasn't arrived. UI uses
  // this to render a "Starting preview…" affordance instead of letting
  // the webview attempt the legacy URL (which 404s in new-mode).
  isBooting: boolean;
}

export function pickPreviewUrl(opts: PickPreviewUrlOptions): PickPreviewUrlResult {
  const { legacyUrl, frontendUrl, isNewMode, workspaceId } = opts;
  if (!workspaceId) {
    // No workspace id at all (output never seeded one). Use whatever
    // legacy URL the caller computed — typical for old flat outputs
    // that were created before workspace_id became standard.
    return { url: legacyUrl, isBooting: false };
  }
  if (isNewMode && !frontendUrl) {
    return { url: undefined, isBooting: true };
  }
  // Prefer frontendUrl when present (works for both new-mode that's up
  // AND any future caller that gives us a Vite URL). Fall back to the
  // legacy serve URL for old-mode workspaces.
  return { url: frontendUrl ?? legacyUrl, isBooting: false };
}
