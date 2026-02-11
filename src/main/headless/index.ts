// Docker agent (was headless-agent.ts)
export { HeadlessAgent, HeadlessAgentOptions, AgentResult, HeadlessAgentStatus, createHeadlessAgent, runHeadlessAgent, startHeadlessAgent } from './docker-agent'

// Standalone agents (was standalone-headless.ts)
export {
  setMainWindowForStandaloneHeadless,
  loadStandaloneHeadlessAgentInfo,
  onStandaloneAgentStatusChange,
  startStandaloneHeadlessAgent,
  getStandaloneHeadlessAgents,
  getStandaloneHeadlessAgentInfo,
  stopStandaloneHeadlessAgent,
  nudgeStandaloneHeadlessAgent,
  initStandaloneHeadless,
  cleanupStandaloneWorktree,
  confirmStandaloneAgentDone,
  restartStandaloneHeadlessAgent,
  startFollowUpAgent,
  startHeadlessDiscussion,
  cancelHeadlessDiscussion,
  startRalphLoopDiscussion,
  cancelRalphLoopDiscussion,
} from './standalone'

// Team (plan-aware) headless agents
export {
  checkHeadlessModeAvailable,
  getHeadlessAgentInfo,
  getHeadlessAgentInfoForPlan,
  startHeadlessTaskAgent,
  stopHeadlessTaskAgent,
  nudgeHeadlessTaskAgent,
  destroyHeadlessAgent,
  stopAllHeadlessAgents,
  taskHasSuccessfulBdClose,
  setupBdCloseListener,
  setOnCriticNeeded,
  setOnTaskReadyForReview,
  setOnCriticCompleted,
  setOnAddPlanActivity,
  setOnEmitTaskAssignmentUpdate,
  setOnEmitPlanUpdate,
} from './team-agents'

// Headless events
export {
  registerHeadlessAgentInfo,
  emitHeadlessAgentUpdatePublic,
  emitHeadlessAgentEventPublic,
  emitHeadlessAgentUpdate,
  emitHeadlessAgentEvent,
} from './events'

// Headless state
export { headlessAgents, headlessAgentInfo, setMainWindow as setHeadlessMainWindow } from './state'
