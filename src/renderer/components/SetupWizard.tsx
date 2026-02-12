import { useState, useEffect, useRef } from 'react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Logo } from '@/renderer/components/Logo'
import { FolderOpen, ChevronRight, ChevronLeft, Loader2, CheckSquare, Square, Clock, Check, X, AlertTriangle, Copy, Circle, Sparkles, Info, ShieldCheck, ExternalLink, Zap } from 'lucide-react'
import type { DiscoveredRepo, Agent, PlanModeDependencies, DescriptionProgressEvent, DescriptionGenerationStatus } from '@/shared/types'
import { SetupTerminal } from './SetupTerminal'
import { devLog } from '../utils/dev-log'

// German/Bismarck-related fun facts for the loading screen
const BISMARCK_FACTS = [
  "Otto von Bismarck unified Germany in 1871, creating the German Empire through a combination of diplomacy and military victories.",
  "Bismarck introduced the world's first comprehensive social security system in the 1880s, including health insurance and pensions.",
  "The Bismarck Archipelago in Papua New Guinea was named after Otto von Bismarck during German colonial expansion.",
  "Bismarck was known as the 'Iron Chancellor' for his strong-willed leadership and 'blood and iron' policies.",
  "The German battleship Bismarck was the largest warship built by Germany and was sunk in 1941 during WWII.",
  "Bismarck famously said: 'Politics is the art of the possible, the attainable — the art of the next best.'",
  "Otto von Bismarck kept a large collection of dogs and was known for his love of Great Danes.",
  "Bismarck served as the first Chancellor of Germany for 19 years, from 1871 to 1890.",
  "The Bismarck herring, a pickled fish delicacy, was named in honor of the Iron Chancellor.",
  "Bismarck was a skilled diplomat who maintained peace in Europe through his complex alliance system."
]

// Format relative time for display
function getRelativeTime(isoDate: string | undefined): string | null {
  if (!isoDate) return null
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  return `${Math.floor(diffDays / 365)} years ago`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

// Client-side GitHub token validation (mirrors exec-utils.ts)
function isValidGitHubToken(value: string): boolean {
  if (!value || value.length < 10) return false
  const validPrefixes = ['ghp_', 'gho_', 'ghs_', 'ghu_', 'github_pat_']
  return validPrefixes.some(prefix => value.startsWith(prefix))
}

interface SetupWizardProps {
  onComplete: (agents: Agent[]) => void
  onSkip: () => void
}

type WizardStep = 'deps' | 'tools' | 'headless-agents' | 'path' | 'repos' | 'desc-choice' | 'descriptions' | 'finish'

export function SetupWizard({ onComplete, onSkip }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('deps')
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [manualPath, setManualPath] = useState<string>('')
  const [suggestedPaths, setSuggestedPaths] = useState<string[]>([])
  const [discoveredRepos, setDiscoveredRepos] = useState<DiscoveredRepo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [isScanning, setIsScanning] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Descriptions step state
  const [repoPurposes, setRepoPurposes] = useState<Map<string, string>>(new Map())
  const [repoCompletionCriteria, setRepoCompletionCriteria] = useState<Map<string, string>>(new Map())
  const [repoProtectedBranches, setRepoProtectedBranches] = useState<Map<string, string[]>>(new Map())
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentFactIndex, setCurrentFactIndex] = useState(0)
  const factIntervalRef = useRef<NodeJS.Timeout | null>(null)
  // Real-time progress tracking
  const [repoStatuses, setRepoStatuses] = useState<Map<string, DescriptionProgressEvent>>(new Map())
  const [latestQuote, setLatestQuote] = useState<string | null>(null)
  const [completedCount, setCompletedCount] = useState(0)
  // Plan mode step state
  const [planModeEnabled, setPlanModeEnabled] = useState(false)
  const [dependencies, setDependencies] = useState<PlanModeDependencies | null>(null)
  const [isCheckingDeps, setIsCheckingDeps] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const [isDetectingToken, setIsDetectingToken] = useState(false)
  const [tokenDetectResult, setTokenDetectResult] = useState<{ success: boolean; source: string | null; reason?: string } | null>(null)
  const [isReloadingToken, setIsReloadingToken] = useState(false)
  // Custom GitHub token input state
  const [showCustomTokenInput, setShowCustomTokenInput] = useState(false)
  const [customGitHubToken, setCustomGitHubToken] = useState('')
  const [savingCustomToken, setSavingCustomToken] = useState(false)
  // Fix with Claude terminal modal state
  const [showFixTerminal, setShowFixTerminal] = useState(false)
  const [fixTerminalId, setFixTerminalId] = useState<string | null>(null)
  const [isSettingUpOAuth, setIsSettingUpOAuth] = useState(false)
  const [oauthSetupResult, setOAuthSetupResult] = useState<{ success: boolean; error?: string } | null>(null)
  // Docker image verification state
  const [isVerifyingImage, setIsVerifyingImage] = useState(false)
  // Docker image pull state
  const [isPullingImage, setIsPullingImage] = useState(false)
  const [pullProgress, setPullProgress] = useState<string | null>(null)
  const [pullResult, setPullResult] = useState<{ success: boolean; error?: string } | null>(null)
  // Docker image choice state
  const [useCustomImage, setUseCustomImage] = useState(false)
  const [customImageName, setCustomImageName] = useState('')
  const [imageCheckResult, setImageCheckResult] = useState<{
    exists: boolean
    digest?: string
    verified?: boolean
    version?: string
    size?: number
    labels?: Record<string, string>
  } | null>(null)
  // Ref to prevent double-clicks during async operations
  const isCreatingRef = useRef(false)

  // Load suggested paths and check dependencies on mount
  useEffect(() => {
    loadSuggestedPaths()
    // Check dependencies on mount for the deps step
    checkDependencies()
  }, [])

  const checkDependencies = async () => {
    setIsCheckingDeps(true)
    try {
      const deps = await window.electronAPI.setupWizardCheckPlanModeDeps()
      setDependencies(deps)
      // Auto-enable plan mode if all required deps are installed
      if (deps.allRequiredInstalled) {
        setPlanModeEnabled(true)
      }
    } catch (err) {
      console.error('Failed to check dependencies:', err)
    } finally {
      setIsCheckingDeps(false)
    }
  }

  // Check image status when dependencies load with an available image
  useEffect(() => {
    if (dependencies?.dockerImage.available && dependencies.docker.installed) {
      setIsVerifyingImage(true)
      window.electronAPI.checkDockerImageStatus(dependencies.dockerImage.imageName).then((result) => {
        if (result.exists) {
          setImageCheckResult({
            exists: true,
            digest: result.digest,
            verified: result.verified,
            version: result.labels?.['org.opencontainers.image.version'],
            size: result.size,
            labels: result.labels,
          })
        }
      }).catch(() => {
        // Ignore errors - metadata is supplementary
      }).finally(() => {
        setIsVerifyingImage(false)
      })
    }
  }, [dependencies?.dockerImage.available, dependencies?.dockerImage.imageName, dependencies?.docker.installed])

  // Cleanup fact interval on unmount
  useEffect(() => {
    return () => {
      if (factIntervalRef.current) {
        clearInterval(factIntervalRef.current)
      }
    }
  }, [])

  const loadSuggestedPaths = async () => {
    try {
      const paths = await window.electronAPI.setupWizardGetCommonRepoPaths()
      setSuggestedPaths(paths)
    } catch (err) {
      console.error('Failed to load suggested paths:', err)
    }
  }

  const handlePickFolder = async () => {
    try {
      const path = await window.electronAPI.setupWizardShowFolderPicker()
      if (path) {
        setSelectedPath(path)
        setManualPath(path)
        setError(null)
      }
    } catch (err) {
      console.error('Failed to pick folder:', err)
      setError('Failed to open folder picker')
    }
  }

  const handleSelectSuggestedPath = (path: string) => {
    setSelectedPath(path)
    setManualPath(path)
    setError(null)
  }

  const handleContinueToRepos = async () => {
    const pathToScan = selectedPath || manualPath.trim()

    if (!pathToScan) {
      setError('Please select or enter a directory')
      return
    }

    setIsScanning(true)
    setError(null)

    try {
      const repos = await window.electronAPI.setupWizardScanForRepositories(pathToScan)

      if (repos.length === 0) {
        setError('No repositories found in this directory')
        setIsScanning(false)
        return
      }

      // Add root directory as a special entry at the top
      const rootName = pathToScan.split('/').pop() || 'root'
      const rootEntry: DiscoveredRepo = {
        path: pathToScan,
        name: `${rootName} (root)`,
      }
      setDiscoveredRepos([rootEntry, ...repos])
      // Pre-select the root directory only
      setSelectedRepos(new Set([pathToScan]))
      // Save the selected path
      await window.electronAPI.setupWizardSaveDefaultReposPath(pathToScan)
      setStep('repos')
    } catch (err) {
      console.error('Failed to scan repositories:', err)
      setError('Failed to scan directory for repositories')
    } finally {
      setIsScanning(false)
    }
  }

  const handleToggleRepo = (repoPath: string) => {
    setSelectedRepos(prev => {
      const next = new Set(prev)
      if (next.has(repoPath)) {
        next.delete(repoPath)
      } else {
        next.add(repoPath)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedRepos(new Set(discoveredRepos.map(r => r.path)))
  }

  const handleDeselectAll = () => {
    setSelectedRepos(new Set())
  }

  // Navigate to descriptions step and start generating
  const handleContinueToDescriptions = async () => {
    if (selectedRepos.size === 0) {
      setError('Please select at least one repository')
      return
    }

    devLog('[SetupWizard] Starting description generation for', selectedRepos.size, 'repos')
    setError(null)
    setIsGenerating(true)
    setStep('descriptions')

    // Reset progress state
    setRepoStatuses(new Map())
    setLatestQuote(null)
    setCompletedCount(0)

    // Start rotating facts
    setCurrentFactIndex(0)
    factIntervalRef.current = setInterval(() => {
      setCurrentFactIndex(prev => (prev + 1) % BISMARCK_FACTS.length)
    }, 4000)

    // Set up progress listener
    window.electronAPI.onDescriptionGenerationProgress((event: DescriptionProgressEvent) => {
      devLog('[SetupWizard] Progress event:', event.repoName, event.status, event.error || '')
      setRepoStatuses(prev => {
        const next = new Map(prev)
        next.set(event.repoPath, event)
        return next
      })

      // Update counts and quote on completion
      if (event.status === 'completed' || event.status === 'error') {
        setCompletedCount(prev => prev + 1)
        if (event.quote) {
          setLatestQuote(event.quote)
        }
      }

      // Update local state with results as they come in
      if (event.status === 'completed' && event.result) {
        devLog('[SetupWizard] Got result for', event.repoName, '- purpose length:', event.result.purpose.length, 'criteria length:', event.result.completionCriteria.length)
        setRepoPurposes(prev => {
          const next = new Map(prev)
          next.set(event.repoPath, event.result!.purpose)
          return next
        })
        setRepoCompletionCriteria(prev => {
          const next = new Map(prev)
          next.set(event.repoPath, event.result!.completionCriteria)
          return next
        })
        setRepoProtectedBranches(prev => {
          const next = new Map(prev)
          next.set(event.repoPath, event.result!.protectedBranches)
          return next
        })
      }
    })

    try {
      const reposToGenerate = discoveredRepos.filter(r => selectedRepos.has(r.path))
      devLog('[SetupWizard] Calling generateDescriptions with', reposToGenerate.length, 'repos:', reposToGenerate.map(r => r.name))
      const results = await window.electronAPI.setupWizardGenerateDescriptions(reposToGenerate)
      devLog('[SetupWizard] Generation complete, got', results.length, 'results')

      // Convert results to Maps (final state, though we've already updated incrementally)
      const purposeMap = new Map<string, string>()
      const criteriaMap = new Map<string, string>()
      const branchesMap = new Map<string, string[]>()
      for (const result of results) {
        devLog('[SetupWizard] Result:', result.repoPath, '- purpose:', (result.purpose || '').substring(0, 50), '- error:', result.error || 'none')
        purposeMap.set(result.repoPath, result.purpose)
        criteriaMap.set(result.repoPath, result.completionCriteria)
        branchesMap.set(result.repoPath, result.protectedBranches)
      }
      setRepoPurposes(purposeMap)
      setRepoCompletionCriteria(criteriaMap)
      setRepoProtectedBranches(branchesMap)
    } catch (err) {
      devLog('[SetupWizard] Generation failed:', err)
      console.error('Failed to generate descriptions:', err)
      // On error, just set empty values - user can edit manually
      const emptyPurposeMap = new Map<string, string>()
      const emptyCriteriaMap = new Map<string, string>()
      const emptyBranchesMap = new Map<string, string[]>()
      for (const repoPath of selectedRepos) {
        emptyPurposeMap.set(repoPath, '')
        emptyCriteriaMap.set(repoPath, '')
        emptyBranchesMap.set(repoPath, [])
      }
      setRepoPurposes(emptyPurposeMap)
      setRepoCompletionCriteria(emptyCriteriaMap)
      setRepoProtectedBranches(emptyBranchesMap)
    } finally {
      setIsGenerating(false)
      if (factIntervalRef.current) {
        clearInterval(factIntervalRef.current)
        factIntervalRef.current = null
      }
      // Clean up the progress listener
      window.electronAPI.removeDescriptionGenerationProgressListener()
    }
  }

  // Final agent creation with purposes, completion criteria, and protected branches
  const handleCreateAgents = async () => {
    // Prevent double-clicks using ref (synchronous check)
    if (isCreatingRef.current) return
    isCreatingRef.current = true
    setIsCreating(true)
    setError(null)

    try {
      // Build repos with all details
      const reposToCreate = discoveredRepos
        .filter(r => selectedRepos.has(r.path))
        .map(r => ({
          ...r,
          purpose: repoPurposes.get(r.path) || '',
          completionCriteria: repoCompletionCriteria.get(r.path) || '',
          protectedBranches: repoProtectedBranches.get(r.path) || [],
        }))
      const agents = await window.electronAPI.setupWizardBulkCreateAgents(reposToCreate)
      await onComplete(agents)
    } catch (err) {
      console.error('Failed to create agents:', err)
      setError('Failed to create agents')
    } finally {
      isCreatingRef.current = false
      setIsCreating(false)
    }
  }

  // Update a single repo's purpose
  const handleUpdatePurpose = (repoPath: string, purpose: string) => {
    setRepoPurposes(prev => {
      const next = new Map(prev)
      next.set(repoPath, purpose)
      return next
    })
  }

  // Update a single repo's completion criteria
  const handleUpdateCompletionCriteria = (repoPath: string, criteria: string) => {
    setRepoCompletionCriteria(prev => {
      const next = new Map(prev)
      next.set(repoPath, criteria)
      return next
    })
  }

  // Update a single repo's protected branches (comma-separated string -> array)
  const handleUpdateProtectedBranches = (repoPath: string, branchesStr: string) => {
    setRepoProtectedBranches(prev => {
      const next = new Map(prev)
      const branches = branchesStr.split(',').map(b => b.trim()).filter(b => b.length > 0)
      next.set(repoPath, branches)
      return next
    })
  }

  // Skip descriptions and go straight to finish with empty defaults
  const handleSkipDescriptions = () => {
    const emptyPurposeMap = new Map<string, string>()
    const emptyCriteriaMap = new Map<string, string>()
    const emptyBranchesMap = new Map<string, string[]>()
    for (const repoPath of selectedRepos) {
      emptyPurposeMap.set(repoPath, '')
      emptyCriteriaMap.set(repoPath, '')
      emptyBranchesMap.set(repoPath, [])
    }
    setRepoPurposes(emptyPurposeMap)
    setRepoCompletionCriteria(emptyCriteriaMap)
    setRepoProtectedBranches(emptyBranchesMap)
    setError(null)
    setStep('finish')
  }

  // Navigate from descriptions to finish step
  const handleContinueToFinish = async () => {
    setError(null)
    setStep('finish')
  }

  // Final step: save plan mode preference and create agents
  const handleContinueFromPlanMode = async () => {
    // Prevent double-clicks using ref (synchronous check)
    if (isCreatingRef.current) return
    isCreatingRef.current = true
    setIsCreating(true)
    setError(null)

    try {
      // Save plan mode preference
      devLog('[SetupWizard] Saving plan mode preference:', planModeEnabled)
      await window.electronAPI.setupWizardEnablePlanMode(planModeEnabled)
      devLog('[SetupWizard] Plan mode preference saved')

      // Save GitHub token if not already configured
      if (planModeEnabled && !dependencies?.githubToken.configured) {
        if (showCustomTokenInput && isValidGitHubToken(customGitHubToken.trim())) {
          console.log('[SetupWizard] Saving custom GitHub token...')
          await window.electronAPI.setGitHubToken(customGitHubToken.trim())
        } else if (dependencies?.githubToken.detected) {
          console.log('[SetupWizard] Auto-saving detected GitHub token...')
          await window.electronAPI.setupWizardDetectAndSaveGitHubToken()
        }
      }

      // Auto-enable bb proxied tool if detected during setup
      if (dependencies?.bb.installed) {
        devLog('[SetupWizard] bb detected, enabling in settings...')
        await window.electronAPI.toggleProxiedTool('bb', true)
      }

      // Build repos with all details
      const reposToCreate = discoveredRepos
        .filter(r => selectedRepos.has(r.path))
        .map(r => ({
          ...r,
          purpose: repoPurposes.get(r.path) || '',
          completionCriteria: repoCompletionCriteria.get(r.path) || '',
          protectedBranches: repoProtectedBranches.get(r.path) || [],
        }))
      devLog('[SetupWizard] Creating', reposToCreate.length, 'agents...')
      const agents = await window.electronAPI.setupWizardBulkCreateAgents(reposToCreate)
      devLog('[SetupWizard] Agents created:', agents.length, '- calling onComplete...')
      await onComplete(agents)
      devLog('[SetupWizard] onComplete finished successfully')
    } catch (err) {
      console.error('[SetupWizard] Failed to create agents:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      setError(`Failed to create agents: ${errorMessage}`)
    } finally {
      isCreatingRef.current = false
      setIsCreating(false)
    }
  }

  // Copy install command to clipboard
  const handleCopyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(command)
      setTimeout(() => setCopiedCommand(null), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  // Detect and save GitHub token
  const handleDetectAndSaveToken = async () => {
    setIsDetectingToken(true)
    setTokenDetectResult(null)
    try {
      const result = await window.electronAPI.setupWizardDetectAndSaveGitHubToken()
      setTokenDetectResult(result)
      // Refresh dependencies to update token status
      if (result.success) {
        const deps = await window.electronAPI.setupWizardCheckPlanModeDeps()
        setDependencies(deps)
      }
    } catch (err) {
      console.error('Failed to detect GitHub token:', err)
      setTokenDetectResult({ success: false, source: null })
    } finally {
      setIsDetectingToken(false)
    }
  }

  // Reload to re-detect GitHub token from shell profile
  const handleReloadToken = async () => {
    setIsReloadingToken(true)
    setTokenDetectResult(null)
    try {
      // Try to detect and save the token - this gives us reason for failure
      const result = await window.electronAPI.setupWizardDetectAndSaveGitHubToken()
      setTokenDetectResult(result)
      // Refresh dependencies to update token status
      const deps = await window.electronAPI.setupWizardCheckPlanModeDeps()
      setDependencies(deps)
    } catch (err) {
      console.error('Failed to reload token:', err)
    } finally {
      setIsReloadingToken(false)
    }
  }

  // Save a manually-entered GitHub token
  const handleSaveCustomGitHubToken = async () => {
    const token = customGitHubToken.trim()
    if (!isValidGitHubToken(token)) return
    setSavingCustomToken(true)
    try {
      await window.electronAPI.setGitHubToken(token)
      // Refresh dependencies to update token status
      const deps = await window.electronAPI.setupWizardCheckPlanModeDeps()
      setDependencies(deps)
      // Reset custom input state
      setShowCustomTokenInput(false)
      setCustomGitHubToken('')
    } catch (err) {
      console.error('Failed to save custom GitHub token:', err)
    } finally {
      setSavingCustomToken(false)
    }
  }

  // Open the "Fix with Claude" terminal modal
  const handleFixWithClaude = async () => {
    try {
      const terminalId = await window.electronAPI.setupWizardCreateFixTerminal()
      setFixTerminalId(terminalId)
      setShowFixTerminal(true)
    } catch (err) {
      console.error('Failed to create fix terminal:', err)
      setError('Failed to open Claude terminal')
    }
  }

  // Close the fix terminal modal and re-check dependencies
  const handleCloseFixTerminal = async () => {
    if (fixTerminalId) {
      try {
        await window.electronAPI.setupWizardCloseFixTerminal(fixTerminalId)
      } catch (err) {
        console.error('Failed to close fix terminal:', err)
      }
    }
    setFixTerminalId(null)
    setShowFixTerminal(false)
    // Re-check dependencies after closing
    checkDependencies()
  }

  // Setup Claude OAuth token
  const handleSetupOAuth = async () => {
    setIsSettingUpOAuth(true)
    setOAuthSetupResult(null)
    try {
      await window.electronAPI.runOAuthSetup()
      setOAuthSetupResult({ success: true })
      // Refresh dependencies to update token status
      const deps = await window.electronAPI.setupWizardCheckPlanModeDeps()
      setDependencies(deps)
    } catch (err) {
      console.error('Failed to setup OAuth token:', err)
      setOAuthSetupResult({ success: false, error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setIsSettingUpOAuth(false)
    }
  }

  // Pull Docker image (official or custom)
  const handlePullDockerImage = async () => {
    setIsPullingImage(true)
    setPullProgress(null)
    setPullResult(null)
    setImageCheckResult(null)

    const imageName = useCustomImage ? customImageName.trim() : dependencies?.dockerImage.imageName
    if (!imageName) {
      setPullResult({ success: false, error: 'No image name specified' })
      setIsPullingImage(false)
      return
    }

    try {
      window.electronAPI.onDockerPullProgress((message: string) => {
        setPullProgress(message)
      })

      let result: { success: boolean; output: string }
      if (useCustomImage) {
        // Pull custom image, then add to settings and select it
        result = await window.electronAPI.pullDockerImage(imageName)
        if (result.success) {
          await window.electronAPI.addDockerImage(imageName)
          await window.electronAPI.setSelectedDockerImage(imageName)
        }
      } else {
        // Pull official image via setup wizard helper
        result = await window.electronAPI.setupWizardPullDockerImage()
      }

      if (result.success) {
        setPullResult({ success: true })
        // Refresh dependencies to update image status
        const deps = await window.electronAPI.setupWizardCheckPlanModeDeps()
        setDependencies(deps)
        // Check full image metadata
        setIsVerifyingImage(true)
        try {
          const info = await window.electronAPI.checkDockerImageStatus(imageName)
          if (info.exists) {
            setImageCheckResult({
              exists: true,
              digest: info.digest,
              verified: info.verified,
              version: info.labels?.['org.opencontainers.image.version'],
              size: info.size,
              labels: info.labels,
            })
          }
        } catch {
          // Metadata check is supplementary
        } finally {
          setIsVerifyingImage(false)
        }
      } else {
        setPullResult({ success: false, error: result.output.substring(0, 200) })
      }
    } catch (err) {
      console.error('Failed to pull Docker image:', err)
      setPullResult({ success: false, error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setIsPullingImage(false)
      window.electronAPI.removeDockerPullProgressListener()
    }
  }

  const handleGoBack = () => {
    if (step === 'finish') {
      // Go back to desc-choice if OAuth configured, otherwise repos
      if (dependencies?.claudeOAuthToken.configured) {
        setStep('desc-choice')
      } else {
        setStep('repos')
      }
    } else if (step === 'descriptions') {
      setStep('desc-choice')
    } else if (step === 'desc-choice') {
      setStep('repos')
    } else if (step === 'repos') {
      setStep('path')
    } else if (step === 'path') {
      setStep('headless-agents')
    } else if (step === 'headless-agents') {
      setStep('tools')
    } else if (step === 'tools') {
      setStep('deps')
    }
    setError(null)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background py-8">
      <div className={`w-full mx-auto px-4 ${step === 'repos' || step === 'descriptions' ? 'max-w-4xl' : 'max-w-2xl'}`}>
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-foreground mb-2">
            <Logo size="lg" />
          </h1>
          <p className="text-muted-foreground text-lg">
            Welcome to Bismarck
          </p>
        </div>

        {/* Wizard Card */}
        <div className="bg-card border border-border rounded-lg shadow-lg p-8">
          {/* Step 1: Dependencies Check */}
          {step === 'deps' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Check Dependencies
                </h2>
                <p className="text-muted-foreground text-sm">
                  Bismarck requires some tools to be installed. Let's verify they're available.
                </p>
              </div>

              {/* Dependencies Section */}
              <div className="space-y-3">
                {isCheckingDeps ? (
                  <div className="flex items-center justify-center p-8 border border-border rounded-lg">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Checking dependencies...</span>
                  </div>
                ) : dependencies ? (
                  <div className="border border-border rounded-lg divide-y divide-border">
                    {[dependencies.claude, dependencies.docker, dependencies.git, dependencies.bd, dependencies.gh].map((dep) => (
                      <div key={dep.name} className="flex items-start justify-between p-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            {dep.installed ? (
                              <Check className="h-5 w-5 text-green-500" />
                            ) : (
                              <X className="h-5 w-5 text-red-500" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{dep.name}</span>
                              {!dep.required && (
                                <span className="text-xs text-muted-foreground">(optional)</span>
                              )}
                            </div>
                            {dep.installed ? (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {dep.path}
                                {dep.version && ` (v${dep.version})`}
                              </p>
                            ) : dep.installCommand ? (
                              <div className="flex items-center gap-2 mt-1">
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                                  {dep.installCommand}
                                </code>
                                <button
                                  onClick={() => handleCopyCommand(dep.installCommand!)}
                                  className="p-1 hover:bg-muted rounded transition-colors"
                                  title="Copy to clipboard"
                                >
                                  {copiedCommand === dep.installCommand ? (
                                    <Check className="h-3 w-3 text-green-500" />
                                  ) : (
                                    <Copy className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-0.5">Not installed</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Re-check button */}
                {!isCheckingDeps && dependencies && (
                  <Button
                    onClick={checkDependencies}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    Re-check Dependencies
                  </Button>
                )}

                {/* Warning if missing required deps */}
                {dependencies && !dependencies.allRequiredInstalled && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-foreground font-medium">Missing required dependencies</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Please install the missing dependencies above before continuing.
                      </p>
                    </div>
                  </div>
                )}

                {/* Fix with Claude button - only shown if Claude is installed and there are missing deps */}
                {dependencies && !dependencies.allRequiredInstalled && dependencies.claude.installed && (
                  <Button
                    onClick={handleFixWithClaude}
                    variant="outline"
                    className="w-full"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Fix with Claude
                  </Button>
                )}
              </div>

              {/* Error Message */}
              {error && (
                <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between pt-4">
                <Button
                  onClick={onSkip}
                  variant="ghost"
                >
                  Skip Setup
                </Button>
                <Button
                  onClick={() => setStep('tools')}
                  disabled={isCheckingDeps || (dependencies !== null && !dependencies.allRequiredInstalled)}
                >
                  Continue
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Additional Tools */}
          {step === 'tools' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Additional Tools
                </h2>
                <p className="text-muted-foreground text-sm">
                  Optional tools that enhance headless agent capabilities
                </p>
              </div>

              {/* bb tool card */}
              {dependencies && (
                <div className="border border-border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {dependencies.bb.installed ? (
                        <Check className="h-5 w-5 text-green-500" />
                      ) : (
                        <X className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">BuildBuddy CLI (bb)</span>
                        <span className="text-xs text-muted-foreground">(optional)</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Enables remote builds with BuildBuddy
                      </p>
                      {dependencies.bb.installed ? (
                        <p className="text-xs text-muted-foreground mt-1">
                          {dependencies.bb.path}
                          {dependencies.bb.version && ` (v${dependencies.bb.version})`}
                        </p>
                      ) : dependencies.bb.installCommand ? (
                        <div className="flex items-center gap-2 mt-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                            {dependencies.bb.installCommand}
                          </code>
                          <button
                            onClick={() => handleCopyCommand(dependencies.bb.installCommand!)}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            title="Copy to clipboard"
                          >
                            {copiedCommand === dependencies.bb.installCommand ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      ) : null}

                      {/* Setup advice info box */}
                      <div className="flex items-start gap-2 mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                        <div className="text-xs text-muted-foreground space-y-1">
                          <p>Export <code className="text-[10px] bg-muted px-1 py-0.5 rounded">BUILDBUDDY_API_KEY</code> in <code className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.zshrc</code> for agents to use bb.</p>
                          <p>Find your key in <code className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.bazelrc</code> or run <code className="text-[10px] bg-muted px-1 py-0.5 rounded">bb login</code> in any git repo.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between pt-4">
                <Button
                  onClick={handleGoBack}
                  variant="ghost"
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep('headless-agents')}
                >
                  Continue
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Headless Agents */}
          {step === 'headless-agents' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Enable Headless Agents
                </h2>
                <p className="text-muted-foreground text-sm">
                  Headless agents run AI agents in parallel using Docker containers. Bismarck runs entirely on your machine — tokens and configuration never leave your device.
                </p>
              </div>

              {/* Headless Agents Toggle */}
              <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card">
                <div className="flex-1">
                  <Label htmlFor="plan-mode-toggle" className="text-sm font-medium text-foreground">
                    Enable Headless Agents
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Run parallel agents in isolated Docker containers
                  </p>
                </div>
                <button
                  id="plan-mode-toggle"
                  role="switch"
                  aria-checked={planModeEnabled}
                  onClick={() => setPlanModeEnabled(!planModeEnabled)}
                  className={`
                    relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent
                    transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                    ${planModeEnabled ? 'bg-primary' : 'bg-muted'}
                  `}
                >
                  <span
                    className={`
                      pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0
                      transition duration-200 ease-in-out
                      ${planModeEnabled ? 'translate-x-5' : 'translate-x-0'}
                    `}
                  />
                </button>
              </div>

              {/* Docker Image Section */}
              {planModeEnabled && dependencies && dependencies.docker.installed && (
                <div className="border border-border rounded-lg p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">Docker Image</span>
                  </div>

                  {/* Image source selector */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { setUseCustomImage(false); setPullResult(null); setImageCheckResult(null) }}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        !useCustomImage
                          ? 'border-primary bg-primary/5 ring-2 ring-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <span className="text-sm font-medium text-foreground block">Official Image</span>
                      <span className="text-xs text-muted-foreground mt-0.5 block">
                        {dependencies.dockerImage.imageName}
                      </span>
                    </button>
                    <button
                      onClick={() => { setUseCustomImage(true); setPullResult(null); setImageCheckResult(null) }}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        useCustomImage
                          ? 'border-primary bg-primary/5 ring-2 ring-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <span className="text-sm font-medium text-foreground block">Custom Image</span>
                      <span className="text-xs text-muted-foreground mt-0.5 block">Use your own image</span>
                    </button>
                  </div>

                  {/* Custom image input */}
                  {useCustomImage && (
                    <div className="space-y-2">
                      <Input
                        placeholder="myregistry/my-agent:latest"
                        value={customImageName}
                        onChange={(e) => setCustomImageName(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        See{' '}
                        <a
                          href="https://hub.docker.com/r/bismarckapp/bismarck-agent"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-0.5"
                        >
                          bismarckapp/bismarck-agent
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {' '}as a base for your custom image.
                      </p>
                    </div>
                  )}

                  {/* Image status metadata */}
                  {isVerifyingImage && !imageCheckResult && !useCustomImage && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">Verifying...</span>
                    </div>
                  )}
                  {(dependencies.dockerImage.available && !useCustomImage || imageCheckResult?.exists) && !isVerifyingImage && (
                    <div className="flex items-center gap-1.5 text-xs flex-wrap">
                      <Check className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-green-600 dark:text-green-400">Installed</span>
                      {(imageCheckResult?.version || dependencies.dockerImage.version) && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">v{imageCheckResult?.version || dependencies.dockerImage.version}</span>
                        </>
                      )}
                      {imageCheckResult?.verified === true && !useCustomImage && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400" title="Image digest verified against Docker Hub registry">
                            <ShieldCheck className="h-3 w-3" />
                            Verified
                          </span>
                        </>
                      )}
                      {(imageCheckResult?.digest || dependencies.dockerImage.digest) && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground font-mono">{(imageCheckResult?.digest || dependencies.dockerImage.digest)!.substring(7, 19)}</span>
                        </>
                      )}
                      {imageCheckResult?.size != null && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{formatBytes(imageCheckResult.size)}</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Not installed indicator */}
                  {!dependencies.dockerImage.available && !useCustomImage && !isPullingImage && !pullResult?.success && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                      <span className="text-muted-foreground">Image not found locally. Pull to get started.</span>
                    </div>
                  )}

                  {/* Pull progress */}
                  {isPullingImage && pullProgress && (
                    <p className="text-xs text-muted-foreground font-mono truncate" title={pullProgress}>
                      {pullProgress}
                    </p>
                  )}

                  {/* Pull result messages */}
                  {pullResult?.success && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Image pulled successfully
                    </p>
                  )}
                  {pullResult && !pullResult.success && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Failed to pull: {pullResult.error}
                    </p>
                  )}

                  {/* Pull button */}
                  {((!dependencies.dockerImage.available && !useCustomImage) || useCustomImage) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePullDockerImage}
                      disabled={isPullingImage || (useCustomImage && !customImageName.trim())}
                    >
                      {isPullingImage ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Pulling...
                        </>
                      ) : (
                        'Pull Image'
                      )}
                    </Button>
                  )}
                </div>
              )}

              {/* GitHub Token Section */}
              {planModeEnabled && dependencies && (
                <div className="border border-border rounded-lg p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    {dependencies.githubToken.configured ? (
                      <Check className="h-5 w-5 text-green-500" />
                    ) : dependencies.githubToken.detected ? (
                      <Check className="h-5 w-5 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium text-foreground">GitHub Token</span>
                    <span className="text-xs text-muted-foreground">(optional)</span>
                  </div>

                  {dependencies.githubToken.configured ? (
                    <p className="text-xs text-muted-foreground">
                      Token configured
                    </p>
                  ) : dependencies.githubToken.detected ? (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Requires <code className="text-[10px] bg-muted px-1 py-0.5 rounded">repo</code> and <code className="text-[10px] bg-muted px-1 py-0.5 rounded">read:packages</code> scopes for creating PRs and accessing packages.
                      </p>

                      {/* Token source selector - two equal cards */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setShowCustomTokenInput(false)}
                          className={`rounded-lg border p-3 text-left transition-all ${
                            !showCustomTokenInput
                              ? 'border-primary bg-primary/5 ring-2 ring-primary'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <span className="text-sm font-medium text-foreground block">Use detected token</span>
                          <span className="text-xs text-muted-foreground mt-0.5 block">
                            From {dependencies.githubToken.source}
                          </span>
                        </button>
                        <button
                          onClick={() => setShowCustomTokenInput(true)}
                          className={`rounded-lg border p-3 text-left transition-all ${
                            showCustomTokenInput
                              ? 'border-primary bg-primary/5 ring-2 ring-primary'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <span className="text-sm font-medium text-foreground block">Use a different token</span>
                          <span className="text-xs text-muted-foreground mt-0.5 block">Provide a fine-grained PAT</span>
                        </button>
                      </div>

                      {/* Custom token: input + save */}
                      {showCustomTokenInput && (
                        <div className="space-y-2">
                          <Input
                            type="password"
                            placeholder="ghp_... or github_pat_..."
                            value={customGitHubToken}
                            onChange={(e) => setCustomGitHubToken(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && isValidGitHubToken(customGitHubToken.trim())) {
                                handleSaveCustomGitHubToken()
                              }
                            }}
                            className="text-sm"
                          />
                          {customGitHubToken.trim() && !isValidGitHubToken(customGitHubToken.trim()) && (
                            <p className="text-xs text-yellow-600 dark:text-yellow-400">
                              Token must start with ghp_, gho_, ghs_, ghu_, or github_pat_
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleSaveCustomGitHubToken}
                            disabled={savingCustomToken || !isValidGitHubToken(customGitHubToken.trim())}
                          >
                            {savingCustomToken ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              'Save token'
                            )}
                          </Button>
                        </div>
                      )}

                      {tokenDetectResult?.success && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Token saved successfully
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tokenDetectResult?.reason === 'command_substitution' ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Token appears to be set via a command (e.g., <code className="text-[10px] bg-muted px-1 py-0.5 rounded">$(op ...)</code>).
                          </p>
                          <p className="text-xs text-muted-foreground">
                            For security, we can't execute shell commands. Please configure the token manually in Settings &gt; Tools.
                          </p>
                        </>
                      ) : tokenDetectResult?.reason === 'unresolved_ref' ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Found <code className="text-[10px] bg-muted px-1 py-0.5 rounded">GITHUB_TOKEN</code> in your shell profile,
                            but it references another variable that isn't exported.
                          </p>
                          <p className="text-xs text-muted-foreground">
                            If it's set by a secrets manager (1Password, Doppler, etc.),
                            copy the token value and configure manually in Settings → Tools.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            No token found in environment or shell profile.
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Add to your shell profile (<code className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.zshrc</code> or <code className="text-[10px] bg-muted px-1 py-0.5 rounded">~/.bashrc</code>):
                          </p>
                          <pre className="text-[10px] bg-muted text-muted-foreground px-2 py-1.5 rounded overflow-x-auto">
                            export GITHUB_TOKEN="ghp_your_token_here"
                          </pre>
                          <p className="text-xs text-muted-foreground">
                            Then reload to detect the token.
                          </p>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReloadToken}
                        disabled={isReloadingToken}
                      >
                        {isReloadingToken ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Reloading...
                          </>
                        ) : (
                          'Reload'
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium">Note:</span> If your org uses SAML SSO, headless agents won't be able to use <code className="text-[10px] bg-muted px-1 py-0.5 rounded">gh auth</code>.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        You can also configure manually in Settings &gt; Tools.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Claude OAuth Token Section */}
              {planModeEnabled && dependencies && (
                <div className="border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {dependencies.claudeOAuthToken.configured ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">Claude OAuth Token</span>
                          <span className="text-xs text-muted-foreground">(required for headless agents)</span>
                        </div>
                        {dependencies.claudeOAuthToken.configured ? (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Token configured
                          </p>
                        ) : (
                          <div className="mt-1">
                            <p className="text-xs text-muted-foreground">
                              OAuth token is required for headless agents to authenticate with Claude.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2"
                              onClick={handleSetupOAuth}
                              disabled={isSettingUpOAuth}
                            >
                              {isSettingUpOAuth ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Setting up...
                                </>
                              ) : (
                                'Setup OAuth Token'
                              )}
                            </Button>
                            {oauthSetupResult?.success && (
                              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                OAuth token saved successfully
                              </p>
                            )}
                            {oauthSetupResult?.error && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                Failed: {oauthSetupResult.error}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between pt-4">
                <Button
                  onClick={handleGoBack}
                  variant="ghost"
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={() => setStep('path')}
                >
                  Continue
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Path Selection */}
          {step === 'path' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Select Repository Directory
                </h2>
                <p className="text-muted-foreground text-sm">
                  Choose a parent directory to scan for git repositories
                </p>
              </div>

              {/* Folder Picker Button */}
              <div>
                <Button
                  onClick={handlePickFolder}
                  variant="outline"
                  className="w-full justify-start"
                  size="lg"
                >
                  <FolderOpen className="h-5 w-5 mr-2" />
                  Choose Directory...
                </Button>
              </div>

              {/* Suggested Paths */}
              {suggestedPaths.length > 0 && (
                <div>
                  <Label className="text-sm text-muted-foreground mb-2 block">
                    Suggested locations
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {suggestedPaths.map((suggestedPath) => (
                      <Button
                        key={suggestedPath}
                        onClick={() => handleSelectSuggestedPath(suggestedPath)}
                        variant={selectedPath === suggestedPath ? 'default' : 'outline'}
                        size="sm"
                      >
                        {suggestedPath.startsWith('/home/') || suggestedPath.startsWith('/Users/')
                          ? suggestedPath.replace(/^\/home\/[^\/]+|^\/Users\/[^\/]+/, '~')
                          : suggestedPath}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Manual Path Input */}
              <div>
                <Label htmlFor="manual-path" className="text-sm mb-2 block">
                  Or enter a path manually
                </Label>
                <Input
                  id="manual-path"
                  type="text"
                  placeholder="/path/to/repositories"
                  value={manualPath}
                  onChange={(e) => {
                    setManualPath(e.target.value)
                    setSelectedPath(e.target.value)
                    setError(null)
                  }}
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between pt-4">
                <Button
                  onClick={handleGoBack}
                  variant="ghost"
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={handleContinueToRepos}
                  disabled={isScanning || (!selectedPath && !manualPath.trim())}
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      Continue
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Repository Selection */}
          {step === 'repos' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Select Repositories
                </h2>
                <p className="text-muted-foreground text-sm">
                  Found {discoveredRepos.length} {discoveredRepos.length === 1 ? 'repository' : 'repositories'}.
                  We recommend starting with your <span className="text-foreground font-medium">3-5 most active</span> repositories.
                </p>
              </div>

              {/* Select All / Deselect All */}
              <div className="flex gap-2">
                <Button
                  onClick={handleSelectAll}
                  variant="outline"
                  size="sm"
                >
                  Select All
                </Button>
                <Button
                  onClick={handleDeselectAll}
                  variant="outline"
                  size="sm"
                >
                  Deselect All
                </Button>
              </div>

              {/* Repository Grid */}
              <div className="max-h-[60vh] overflow-y-auto">
                {discoveredRepos.length === 0 ? (
                  <div className="p-8 text-center border border-border rounded-md">
                    <p className="text-muted-foreground mb-4">
                      No repositories found
                    </p>
                    <div className="flex gap-2 justify-center">
                      <Button onClick={handleGoBack} variant="outline">
                        Go Back
                      </Button>
                      <Button onClick={onSkip} variant="ghost">
                        Skip Setup
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-1">
                    {discoveredRepos.map((repo) => {
                      const isSelected = selectedRepos.has(repo.path)
                      return (
                        <button
                          key={repo.path}
                          onClick={() => handleToggleRepo(repo.path)}
                          className={`
                            relative rounded-lg border p-4 text-left transition-all
                            hover:border-primary/50
                            ${isSelected
                              ? 'border-primary bg-primary/5 ring-2 ring-primary'
                              : 'border-border bg-card hover:bg-accent/50'
                            }
                          `}
                        >
                          {/* Selection indicator */}
                          <div className="absolute top-2 right-2">
                            {isSelected ? (
                              <CheckSquare className="h-5 w-5 text-primary" />
                            ) : (
                              <Square className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>

                          {/* Repo name */}
                          <h4 className="font-semibold text-foreground pr-6 truncate">
                            {repo.name}
                          </h4>

                          {/* Path (truncated) */}
                          <p className="text-xs text-muted-foreground mt-1 truncate" title={repo.path}>
                            {repo.path}
                          </p>

                          {/* Last commit time */}
                          {repo.lastCommitDate && (
                            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground/80">
                              <Clock className="h-3 w-3" />
                              <span>{getRelativeTime(repo.lastCommitDate)}</span>
                            </div>
                          )}

                          {/* Remote URL (optional, subtle) */}
                          {repo.remoteUrl && (
                            <p className="text-[10px] text-muted-foreground/60 mt-1 truncate" title={repo.remoteUrl}>
                              {repo.remoteUrl.replace(/^(git@|https:\/\/)/, '').replace(/\.git$/, '')}
                            </p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Error Message */}
              {error && (
                <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  {error}
                </div>
              )}

              {/* Actions */}
              {discoveredRepos.length > 0 && (
                <div className="flex justify-between pt-4">
                  <Button
                    onClick={handleGoBack}
                    variant="ghost"
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  <Button
                    onClick={() => {
                      if (selectedRepos.size === 0) {
                        setError('Please select at least one repository')
                        return
                      }
                      setError(null)
                      // Skip desc-choice if no OAuth token configured (can't run claude -p)
                      if (dependencies?.claudeOAuthToken.configured) {
                        setStep('desc-choice')
                      } else {
                        handleSkipDescriptions()
                      }
                    }}
                    disabled={selectedRepos.size === 0}
                  >
                    Continue
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step: Description Choice */}
          {step === 'desc-choice' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Repository Descriptions
                </h2>
                <p className="text-muted-foreground text-sm">
                  Descriptions help the orchestrator allocate tasks to the right repos and tell agents when their work is done.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Auto-generate card */}
                <button
                  onClick={handleContinueToDescriptions}
                  className="rounded-lg border border-border p-6 text-left transition-all hover:border-primary/50 hover:bg-accent/50 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">Auto-generate with Claude</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Claude will analyze each repository and generate purpose descriptions and completion criteria automatically.
                  </p>
                </button>

                {/* Skip card */}
                <button
                  onClick={handleSkipDescriptions}
                  className="rounded-lg border border-border p-6 text-left transition-all hover:border-primary/50 hover:bg-accent/50 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Skip, configure later</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You can add descriptions later in Settings. Agents will still work, but task allocation may be less accurate.
                  </p>
                </button>
              </div>

              {/* Actions */}
              <div className="flex justify-between pt-4">
                <Button
                  onClick={handleGoBack}
                  variant="ghost"
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              </div>
            </div>
          )}

          {/* Step: Descriptions */}
          {step === 'descriptions' && (
            <div className="space-y-6">
              {isGenerating ? (
                /* Loading state with real-time progress */
                <div className="space-y-6">
                  {/* Progress header */}
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold text-foreground">
                      Analyzing Repositories...
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {completedCount} of {selectedRepos.size} complete
                    </p>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-500 ease-out"
                      style={{ width: `${selectedRepos.size > 0 ? (completedCount / selectedRepos.size) * 100 : 0}%` }}
                    />
                  </div>

                  {/* Victory quote card - animated appearance */}
                  {latestQuote && (
                    <div
                      key={latestQuote}
                      className="bg-primary/10 border border-primary/20 rounded-lg p-4 animate-in fade-in slide-in-from-top-2 duration-300"
                    >
                      <p className="text-sm text-foreground italic text-center">
                        "{latestQuote}"
                      </p>
                      <p className="text-xs text-muted-foreground text-center mt-2">— Otto von Bismarck</p>
                    </div>
                  )}

                  {/* Repository grid with status icons */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[40vh] overflow-y-auto p-1">
                    {discoveredRepos
                      .filter(r => selectedRepos.has(r.path))
                      .map((repo) => {
                        const status = repoStatuses.get(repo.path)
                        const statusValue = status?.status || 'pending'
                        return (
                          <div
                            key={repo.path}
                            className={`
                              relative rounded-lg border p-3 transition-all duration-300
                              ${statusValue === 'pending' ? 'border-border bg-card' : ''}
                              ${statusValue === 'generating' ? 'border-primary bg-primary/5' : ''}
                              ${statusValue === 'completed' ? 'border-green-500/50 bg-green-500/5' : ''}
                              ${statusValue === 'error' ? 'border-destructive/50 bg-destructive/5' : ''}
                            `}
                          >
                            {/* Status icon */}
                            <div className="absolute top-2 right-2">
                              {statusValue === 'pending' && (
                                <Circle className="h-4 w-4 text-muted-foreground" />
                              )}
                              {statusValue === 'generating' && (
                                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                              )}
                              {statusValue === 'completed' && (
                                <div className="animate-in zoom-in duration-200">
                                  <Check className="h-4 w-4 text-green-500" />
                                </div>
                              )}
                              {statusValue === 'error' && (
                                <X className="h-4 w-4 text-destructive" />
                              )}
                            </div>

                            {/* Repo name */}
                            <h4 className="font-medium text-sm text-foreground pr-6 truncate">
                              {repo.name}
                            </h4>

                            {/* Status text */}
                            <p className="text-xs text-muted-foreground mt-1">
                              {statusValue === 'pending' && 'Waiting...'}
                              {statusValue === 'generating' && 'Generating...'}
                              {statusValue === 'completed' && 'Complete'}
                              {statusValue === 'error' && (status?.error || 'Error')}
                            </p>
                          </div>
                        )
                      })}
                  </div>

                  {/* Rotating fun facts at the bottom */}
                  <div className="bg-muted/50 border border-border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground italic text-center">
                      "{BISMARCK_FACTS[currentFactIndex]}"
                    </p>
                  </div>
                </div>
              ) : (
                /* Review and edit descriptions */
                <>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground mb-2">
                      Review Descriptions
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      AI-generated purpose descriptions for your repositories. Edit them as needed.
                    </p>
                  </div>

                  {/* Descriptions list - single column */}
                  <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                    {discoveredRepos
                      .filter(r => selectedRepos.has(r.path))
                      .map((repo) => (
                        <div key={repo.path} className="border border-border rounded-lg p-4 space-y-3">
                          <div>
                            <Label className="text-sm font-medium text-foreground block mb-1">
                              {repo.name}
                            </Label>
                            <p className="text-xs text-muted-foreground truncate" title={repo.path}>
                              {repo.path}
                            </p>
                          </div>

                          {/* Purpose */}
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Label className="text-xs text-muted-foreground">
                                Purpose
                              </Label>
                              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 font-medium">
                                <Zap className="h-3 w-3" />
                                Used for task allocation
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mb-1.5">
                              Used by the orchestrator to determine which repo handles which tasks, and for grouping repos in the sidebar.
                            </p>
                            <textarea
                              className="w-full min-h-[100px] p-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                              placeholder="What does this repository do?"
                              value={repoPurposes.get(repo.path) || ''}
                              onChange={(e) => handleUpdatePurpose(repo.path, e.target.value)}
                            />
                          </div>

                          {/* Completion Criteria */}
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Label className="text-xs text-muted-foreground">
                                Completion Criteria
                              </Label>
                              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 font-medium">
                                <Zap className="h-3 w-3" />
                                Injected into standalone & PR-mode task agent prompts
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mb-1.5">
                              Agents validate work against these before creating PRs. They iterate until all criteria pass.
                            </p>
                            <textarea
                              className="w-full min-h-[120px] p-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring font-mono text-xs"
                              placeholder="- Tests pass&#10;- Code is linted&#10;- Build succeeds"
                              value={repoCompletionCriteria.get(repo.path) || ''}
                              onChange={(e) => handleUpdateCompletionCriteria(repo.path, e.target.value)}
                            />
                          </div>

                          {/* Protected Branches */}
                          <div>
                            <Label className="text-xs text-muted-foreground block mb-1">
                              Protected Branches
                            </Label>
                            <Input
                              className="text-sm"
                              placeholder="main, master, release/*"
                              value={(repoProtectedBranches.get(repo.path) || []).join(', ')}
                              onChange={(e) => handleUpdateProtectedBranches(repo.path, e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Comma-separated list of branches that should not be modified directly
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* Error Message */}
                  {error && (
                    <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md p-3">
                      {error}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex justify-between pt-4">
                    <Button
                      onClick={handleGoBack}
                      variant="ghost"
                    >
                      <ChevronLeft className="h-4 w-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      onClick={handleContinueToFinish}
                    >
                      Continue
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step: Finish - Create Agents */}
          {step === 'finish' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Ready to Create Agents
                </h2>
                <p className="text-muted-foreground text-sm">
                  {selectedRepos.size} {selectedRepos.size === 1 ? 'repository' : 'repositories'} selected.
                  {planModeEnabled ? ' Headless agents are enabled.' : ' Headless agents are disabled.'}
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between pt-4">
                <Button
                  onClick={handleGoBack}
                  variant="ghost"
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={handleContinueFromPlanMode}
                  disabled={isCreating}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Agents...
                    </>
                  ) : (
                    <>
                      Create {selectedRepos.size} {selectedRepos.size === 1 ? 'Agent' : 'Agents'}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Skip link at bottom */}
        {(step === 'deps' || step === 'tools' || step === 'headless-agents' || step === 'path') && (
          <div className="text-center mt-4">
            <button
              onClick={onSkip}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              I'll set up agents manually
            </button>
          </div>
        )}
      </div>

      {/* Fix with Claude Modal */}
      {showFixTerminal && fixTerminalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-lg shadow-xl w-[90vw] max-w-4xl h-[80vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-foreground">Fix with Claude</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Claude will help you install missing dependencies
              </p>
            </div>

            {/* Terminal */}
            <div className="flex-1 p-2 min-h-0">
              <SetupTerminal terminalId={fixTerminalId} />
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end px-4 py-3 border-t border-border">
              <Button onClick={handleCloseFixTerminal}>
                Close & Re-check
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
