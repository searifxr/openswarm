// Shared skipIf predicates. Each returns true when the corresponding step
// is already-done in current Redux state — used to pre-mark completed
// milestones for upgrading users and to short-circuit "Show me" if the
// user already did the thing.

import type { RootState } from '@/shared/state/store';

export function hasModelConnected(s: RootState): boolean {
  const d = s.settings.data as any;
  if (!d) return false;
  if (d.connection_mode === 'openswarm-pro' && d.openswarm_bearer_token) return true;
  return Boolean(
    d.anthropic_api_key ||
      d.openai_api_key ||
      d.google_api_key ||
      d.openrouter_api_key,
  );
}

export function hasAnyToolEnabled(s: RootState): boolean {
  const items = s.tools?.items ?? {};
  // Match the Switch's read in Tools.tsx: `tool.enabled !== false`. Tools
  // installed before the `enabled` field existed have it as undefined,
  // which the Switch treats as "on" — so we should too. Otherwise step 2
  // never auto-skips for users who already have integrations installed.
  return Object.values(items).some((t: any) => t?.enabled !== false);
}

// True when a Reddit-shaped tool is currently enabled. Used by step 2's
// wait-for-toggle so the wait only resolves when Reddit is actually ON,
// regardless of how many times the user toggles. Catches the case where
// the user's first click turns OFF an already-enabled Reddit, then
// toggles back on — naive click_target waits would advance on the
// off-click and leave AC out of sync.
export function isRedditEnabled(s: RootState): boolean {
  const items = s.tools?.items ?? {};
  return Object.values(items).some((t: any) => {
    const name = (t?.name ?? '').toLowerCase();
    const command = (t?.command ?? '').toLowerCase();
    const isReddit = name === 'reddit' || command.includes('reddit');
    return isReddit && t?.enabled !== false;
  });
}

export function hasAnyAgentLaunched(s: RootState): boolean {
  const sessions = s.agents?.sessions ?? {};
  return Object.keys(sessions).length > 0;
}

export function hasAnySkillInstalled(s: RootState): boolean {
  const items = s.skills?.items ?? [];
  if (Array.isArray(items)) return items.length > 0;
  return Object.keys(items).length > 0;
}
