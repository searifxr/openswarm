import type { OnboardingStep } from './types';
import { S } from '../selectors';
import { hasAnySkillInstalled } from './skipPredicates';

export const step07: OnboardingStep = {
  id: 'install_skill',
  stage: 'learn_features',
  index: 7,
  title: 'Install a skill',
  description: 'Teach agents how to handle specific tasks.',
  videoSrc: '/onboarding-videos/v2/07.mp4',
  videoDurationLabel: '0:24',
  skipIf: hasAnySkillInstalled,
  ops: [
    { kind: 'move_to', target: S.sidebarSkills },
    { kind: 'popup', text: 'Click here!' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.sidebarSkills },
    },
    { kind: 'move_to', target: S.skillItemPdf },
    { kind: 'popup', text: 'Click here!' },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.skillItemPdf },
    },
    { kind: 'move_to', target: S.skillInstallButton },
    { kind: 'popup', text: 'Click here!' },
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'skill:installed' },
      timeoutMs: 60000,
    },
    {
      kind: 'popup',
      text: 'Now any agent will be much better at working with PDFs.',
    },
    { kind: 'move_to', target: S.skillBuilderFab },
    { kind: 'click', target: S.skillBuilderFab, simulate: true },
    {
      kind: 'popup',
      text: 'You can also prompt new skills into existence with the skill builder here.',
    },
    { kind: 'delay', ms: 3500 },
    { kind: 'outro' },
  ],
};
