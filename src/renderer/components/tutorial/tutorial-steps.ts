import type { TutorialStep, OperatingMode } from '@/shared/types'

export type TutorialAction =
  | 'openCommandPalette'
  | 'closeCommandPalette'
  | 'simulateAttention'
  | 'clearSimulatedAttention'

export interface TutorialStepDefinition {
  id: TutorialStep
  title: string
  description: string
  target: string // data-tutorial attribute value
  placement?: 'top' | 'bottom' | 'left' | 'right'
  condition?: (operatingMode: OperatingMode) => boolean
  onEnter?: TutorialAction // Action to perform when entering this step
  onExit?: TutorialAction // Action to perform when leaving this step
}

export const tutorialSteps: TutorialStepDefinition[] = [
  {
    id: 'welcome',
    title: 'Welcome to Bismarck',
    description: 'Bismarck is a multi-agent IDE that helps you coordinate multiple Claude agents working together. Let\'s take a quick tour of the key features.',
    target: 'center', // Special target for centered modal
    placement: 'bottom',
  },
  {
    id: 'workspace',
    title: 'Agents',
    description: 'Each agent has its own workspace and can work independently on different tasks. Click the "+" button to create new agents.',
    target: 'agents',
    placement: 'top',
  },
  {
    id: 'agent-lifecycle',
    title: 'Starting & Stopping Agents',
    description: 'To **start** an agent, click the "+" button or use Cmd+K to search and start any agent.\n\nTo **stop** an agent, close its tab or right-click for options. You can also use **Cmd+W** to close the focused agent.\n\nAgents run independently and persist their conversation history.',
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
    description: 'Press Cmd+K (or Ctrl+K) anytime to open the Command Palette. From here you can:\n\n• **Start: Plan** - Create multi-agent plans for complex tasks\n• **Start: Headless Agent** - Run background agents without a terminal\n• **Start: Ralph Loop** - Run iterative agent loops\n• Search and jump to any agent by name',
    target: 'cmd-k',
    placement: 'bottom',
    onEnter: 'openCommandPalette',
    onExit: 'closeCommandPalette',
  },
  {
    id: 'attention',
    title: 'Agent Attention',
    description: 'When an agent needs your input, it pulses with a yellow ring to get your attention. The header also shows how many agents are waiting.\n\nClick the agent or use **Cmd+N** to cycle through waiting agents.',
    target: 'waiting-agent',
    placement: 'right',
    onEnter: 'simulateAttention',
    onExit: 'clearSimulatedAttention',
  },
  {
    id: 'team-mode',
    title: 'Teams',
    description: 'Click the **Plans** button to create and manage multi-agent plans. Plans let you coordinate multiple agents working in parallel on complex tasks.\n\nEach plan runs in isolated git worktrees to prevent conflicts.',
    target: 'plan-mode',
    placement: 'left',
    condition: (operatingMode) => operatingMode === 'team',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Customize Bismarck to your preferences. You can restart this tutorial anytime from the Settings page.',
    target: 'settings-button',
    placement: 'left',
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
