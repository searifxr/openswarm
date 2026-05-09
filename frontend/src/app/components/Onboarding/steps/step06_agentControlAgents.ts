import type { OnboardingStep } from './types';
import { S } from '../selectors';

export const step06: OnboardingStep = {
  id: 'agent_control_agents',
  stage: 'learn_features',
  index: 6,
  title: 'Have an agent control other agents',
  description: 'Let an agent orchestrate other agents.',
  videoSrc: '/onboarding-videos/v2/06.mp4',
  videoDurationLabel: '0:34',
  requiresDashboard: true,
  ops: [
    // The OnboardingRoot pre-runs `seed-orchestration-demo` before a step-6
    // start so a stub "research" agent already exists on the canvas. The
    // popup below tells the user to imagine they made it themselves.
    {
      kind: 'popup',
      text: "Pretend this agent already did some research for you. We'll have a NEW agent orchestrate it.",
    },
    { kind: 'move_to', target: S.newAgentButton },
    { kind: 'popup', text: 'Spin up a new agent — this one will be the orchestrator.' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.newAgentButton },
    },
    { kind: 'move_to', target: S.elementSelectionToggle },
    { kind: 'popup', text: 'Click here to attach the existing agent.' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.elementSelectionToggle },
    },
    { kind: 'drag_select', target: 'agent-card' },
    {
      kind: 'popup',
      text: 'Now you try — drag a box around the agent card to attach it as a sub-agent.',
    },
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'agent:attached_to_browser' },
      // Reuses the same attached event as step 5 for now — backend emits
      // it for any element-selection attachment regardless of element type.
      timeoutMs: 90000,
    },
    { kind: 'move_to', target: S.chatInput },
    {
      kind: 'type_into',
      target: S.chatInput,
      text: 'Create a pdf report of the research and save it to my downloads',
      speedMs: 12,
    },
    { kind: 'move_to', target: S.chatSendButton },
    { kind: 'click', target: S.chatSendButton, simulate: true },
    // Wait for the user's message to actually go out — short wait, just
    // to confirm the orchestration kicked off. Don't wait for the agent
    // to fully finish: orchestrators legitimately run for minutes,
    // sub-agents loop while doing real work, and trapping the user
    // in step 6 until everything settles is the worst possible UX.
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'chat:message_sent' },
      timeoutMs: 30000,
    },
    {
      kind: 'popup',
      text: 'Your orchestrator is on it. The PDF will land in Downloads when the sub-agents finish — feel free to keep exploring while they work.',
    },
    { kind: 'delay', ms: 4000 },
    { kind: 'outro' },
  ],
};
