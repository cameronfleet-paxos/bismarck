import type { TutorialStep, OperatingMode } from '@/shared/types'

export interface TutorialStepDefinition {
  id: TutorialStep
  title: string
  description: string
  target: string // data-tutorial attribute value
  placement?: 'top' | 'bottom' | 'left' | 'right'
  condition?: (operatingMode: OperatingMode) => boolean
}

export const tutorialSteps: TutorialStepDefinition[] = [
  {
    id: 'welcome',
    title: 'Welcome to Bismarck',
    description: 'Bismarck is a multi-agent IDE that helps you coordinate multiple Claude agents working together. Let\'s take a quick tour of the key features.',
    target: 'agents',
    placement: 'top',
  },
  {
    id: 'workspace',
    title: 'Agents',
    description: 'Each agent has its own workspace and can work independently on different tasks. Click the "+" button to create new agents.',
    target: 'agents',
    placement: 'top',
  },
  {
    id: 'tabs',
    title: 'Tabs & Grid Layout',
    description: 'Organize your agents into tabs with customizable grid layouts. Switch between different workspace configurations easily.',
    target: 'tabs',
    placement: 'bottom',
  },
  {
    id: 'terminal',
    title: 'Command Palette',
    description: 'Use Cmd+K (or Ctrl+K) to quickly access commands, search agents, and navigate between workspaces.',
    target: 'cmd-k',
    placement: 'bottom',
  },
  {
    id: 'attention',
    title: 'Attention Queue',
    description: 'When agents need your input, they appear in the attention queue. Click to quickly jump to agents that need attention.',
    target: 'attention',
    placement: 'left',
  },
  {
    id: 'team-mode',
    title: 'Plan Mode',
    description: 'Switch to Team mode to create plans and coordinate multiple agents working on complex tasks. Agents can work in parallel on different parts of your project.',
    target: 'plan-mode',
    placement: 'left',
    condition: (operatingMode) => operatingMode === 'team',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Customize Bismarck to your preferences. You can restart this tutorial anytime from the Settings page.',
    target: 'agents',
    placement: 'top',
  },
]

export function getAvailableSteps(operatingMode: OperatingMode): TutorialStepDefinition[] {
  return tutorialSteps.filter(step => {
    if (step.condition) {
      return step.condition(operatingMode)
    }
    return true
  })
}
