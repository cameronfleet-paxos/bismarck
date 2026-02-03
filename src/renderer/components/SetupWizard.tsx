import { useState, useEffect, useRef } from 'react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Logo } from '@/renderer/components/Logo'
import { FolderOpen, ChevronRight, ChevronLeft, Loader2, CheckSquare, Square, Clock, Check, X, AlertTriangle, Copy, Circle } from 'lucide-react'
import type { DiscoveredRepo, Agent, PlanModeDependencies, DescriptionProgressEvent, DescriptionGenerationStatus } from '@/shared/types'

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

interface SetupWizardProps {
  onComplete: (agents: Agent[]) => void
  onSkip: () => void
}

type WizardStep = 'deps' | 'path' | 'repos' | 'descriptions' | 'plan-mode'

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
      const results = await window.electronAPI.setupWizardGenerateDescriptions(reposToGenerate)

      // Convert results to Maps (final state, though we've already updated incrementally)
      const purposeMap = new Map<string, string>()
      const criteriaMap = new Map<string, string>()
      const branchesMap = new Map<string, string[]>()
      for (const result of results) {
        purposeMap.set(result.repoPath, result.purpose)
        criteriaMap.set(result.repoPath, result.completionCriteria)
        branchesMap.set(result.repoPath, result.protectedBranches)
      }
      setRepoPurposes(purposeMap)
      setRepoCompletionCriteria(criteriaMap)
      setRepoProtectedBranches(branchesMap)
    } catch (err) {
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
      onComplete(agents)
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

  // Navigate from descriptions to plan-mode step
  const handleContinueToPlanMode = async () => {
    setError(null)
    setStep('plan-mode')
    // Dependencies were already checked on mount, no need to re-check
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
      await window.electronAPI.setupWizardEnablePlanMode(planModeEnabled)

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
      onComplete(agents)
    } catch (err) {
      console.error('Failed to create agents:', err)
      setError('Failed to create agents')
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

  const handleGoBack = () => {
    if (step === 'plan-mode') {
      setStep('descriptions')
    } else if (step === 'descriptions') {
      setStep('repos')
    } else if (step === 'repos') {
      setStep('path')
    } else if (step === 'path') {
      setStep('deps')
    }
    setError(null)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background py-8">
      <div className={`w-full mx-auto px-4 ${step === 'repos' ? 'max-w-4xl' : 'max-w-2xl'}`}>
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
                  onClick={() => setStep('path')}
                  disabled={isCheckingDeps || (dependencies !== null && !dependencies.allRequiredInstalled)}
                >
                  Continue
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Path Selection */}
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
                    onClick={handleContinueToDescriptions}
                    disabled={selectedRepos.size === 0}
                  >
                    Continue
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Descriptions */}
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

                  {/* Descriptions list - 2 column grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[50vh] overflow-y-auto">
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
                            <Label className="text-xs text-muted-foreground block mb-1">
                              Purpose
                            </Label>
                            <textarea
                              className="w-full min-h-[100px] p-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                              placeholder="What does this repository do?"
                              value={repoPurposes.get(repo.path) || ''}
                              onChange={(e) => handleUpdatePurpose(repo.path, e.target.value)}
                            />
                          </div>

                          {/* Completion Criteria */}
                          <div>
                            <Label className="text-xs text-muted-foreground block mb-1">
                              Completion Criteria
                            </Label>
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
                      onClick={handleContinueToPlanMode}
                    >
                      Continue
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 5: Headless Agents */}
          {step === 'plan-mode' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Enable Headless Agents
                </h2>
                <p className="text-muted-foreground text-sm">
                  Headless agents run AI agents in parallel using Docker containers.
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

              {/* GitHub Token Section */}
              {planModeEnabled && dependencies && (
                <div className="border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {dependencies.githubToken.configured ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : dependencies.githubToken.detected ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">GitHub Token</span>
                          <span className="text-xs text-muted-foreground">(optional)</span>
                        </div>
                        {dependencies.githubToken.configured ? (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Token configured
                          </p>
                        ) : dependencies.githubToken.detected ? (
                          <div className="mt-1">
                            <p className="text-xs text-muted-foreground">
                              Found token from {dependencies.githubToken.source}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2"
                              onClick={handleDetectAndSaveToken}
                              disabled={isDetectingToken}
                            >
                              {isDetectingToken ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                'Use detected token'
                              )}
                            </Button>
                            {tokenDetectResult?.success && (
                              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                Token saved successfully
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1">
                            <p className="text-xs text-muted-foreground">
                              No token found in environment or shell profile.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Configure in Settings &gt; Tools if needed for SAML SSO organizations.
                            </p>
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
        {(step === 'deps' || step === 'path') && (
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
    </div>
  )
}
