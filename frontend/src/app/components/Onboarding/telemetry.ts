// Onboarding v2 telemetry — wraps the existing report() surface so all
// events land under surface='onboarding_v2' (separate from the legacy
// onboarding/walkthrough rows so dashboards stay clean during transition).
//
// Standard properties on every report:
//   step_id        — current step (or 'panel' / 'roadmap' for non-step events)
//   stage          — 'get_started' | 'customize'
//   ms_since_step  — time since the active step started (panel "Show me" click)
// Plus whatever the caller passes in.

import { report as _report } from '@/shared/serviceClient';

let _stepStartTs: number | null = null;

export function markStepStarted(): void {
  _stepStartTs = Date.now();
}

export function clearStepTiming(): void {
  _stepStartTs = null;
}

export function report(
  action: string,
  props?: Record<string, unknown>,
): void {
  const enriched: Record<string, unknown> = { ...(props ?? {}) };
  if (_stepStartTs !== null) {
    enriched.ms_since_step = Date.now() - _stepStartTs;
  }
  _report('onboarding_v2', action, enriched);
}
