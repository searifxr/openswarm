import type { OnboardingStep } from './types';
import { S } from '../selectors';

export const step05: OnboardingStep = {
  id: 'agent_use_browser',
  stage: 'learn_features',
  index: 5,
  title: 'Have an agent use the browser',
  description: 'Let an agent take control of your browser.',
  videoSrc: '/onboarding-videos/v2/05.mp4',
  videoDurationLabel: '0:30',
  requiresDashboard: true,
  dependsOn: [{ stepId: 'use_browser', reopen: 'walk_again' }],
  ops: [
    { kind: 'move_to', target: S.newAgentButton },
    { kind: 'popup', text: 'Spin up a new agent that will use the browser.' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.newAgentButton },
    },
    { kind: 'move_to', target: S.elementSelectionToggle },
    { kind: 'popup', text: 'Click here to attach a browser to this agent.' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.elementSelectionToggle },
    },
    // AC demonstrates the drag-select on the browser card, then asks the
    // user to do the same gesture for real (the actual product wires up
    // the selection during a real mouse drag).
    { kind: 'drag_select', target: 'browser-card' },
    {
      kind: 'popup',
      text: 'Now you try — drag a box around the browser card to attach it.',
    },
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'agent:attached_to_browser' },
      timeoutMs: 90000,
    },
    { kind: 'move_to', target: S.chatInput },
    {
      kind: 'type_into',
      target: S.chatInput,
      text: 'Pull up the open swarm website (openswarm.com) and find the docs',
      speedMs: 12,
    },
    { kind: 'move_to', target: S.chatSendButton },
    { kind: 'click', target: S.chatSendButton, simulate: true },
    { kind: 'outro' },
  ],
};
