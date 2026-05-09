import type { OnboardingStep } from './types';
import { S } from '../selectors';
import { hasAnyToolEnabled, isRedditEnabled } from './skipPredicates';

export const step02: OnboardingStep = {
  id: 'enable_actions',
  stage: 'get_started',
  index: 2,
  title: 'Enable agentic actions',
  description: 'Allow agents to work across your apps.',
  videoSrc: '/onboarding-videos/v2/02.mp4',
  videoDurationLabel: '0:24',
  skipIf: hasAnyToolEnabled,
  ops: [
    { kind: 'move_to', target: S.sidebarActions },
    { kind: 'popup', text: 'Click here!' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.sidebarActions },
    },
    // Reddit toggle. Wait on REDUX STATE (Reddit enabled), not a single
    // click. If the user's Reddit was already on and they accidentally
    // toggle it off, then back on, we still advance correctly when it
    // ends up enabled — instead of the wait resolving on the first
    // click (toggle-off) and AC drifting out of sync.
    { kind: 'move_to', target: S.actionsRedditToggle },
    { kind: 'popup', text: 'Click here!' },
    {
      kind: 'wait_user',
      condition: {
        kind: 'redux_predicate',
        selector: isRedditEnabled,
        truthy: true,
      },
      timeoutMs: 90000,
    },
    // After Reddit is enabled, expand its action group via the chevron.
    { kind: 'move_to', target: S.actionsRedditChevron },
    { kind: 'popup', text: 'Click here!' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.actionsRedditChevron },
    },
    // Now drill into the Subreddits sub-group.
    { kind: 'move_to', target: S.actionsSubredditsChevron },
    { kind: 'popup', text: 'Click here!' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.actionsSubredditsChevron },
    },
    // Hover (no click) over the permission toggle to draw attention,
    // popup explaining what it is, then just wait a beat — spec says
    // no user input needed past this point.
    { kind: 'move_to', target: S.actionsPermissionToggle },
    {
      kind: 'popup',
      text: 'You can set permissions for individual actions here.',
    },
    { kind: 'delay', ms: 3500 },
    { kind: 'outro' },
  ],
};
