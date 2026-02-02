import { useState, useEffect } from 'react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Logo } from '@/renderer/components/Logo'
import { FolderOpen, ChevronRight, ChevronLeft, Loader2, CheckSquare, Square } from 'lucide-react'
import type { DiscoveredRepo, Agent } from '@/shared/types'

interface SetupWizardProps {
  onComplete: (agents: Agent[]) => void
  onSkip: () => void
}

type WizardStep = 'path' | 'repos'

export function SetupWizard({ onComplete, onSkip }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('path')
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [manualPath, setManualPath] = useState<string>('')
  const [suggestedPaths, setSuggestedPaths] = useState<string[]>([])
  const [discoveredRepos, setDiscoveredRepos] = useState<DiscoveredRepo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [isScanning, setIsScanning] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load suggested paths on mount
  useEffect(() => {
    loadSuggestedPaths()
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

      setDiscoveredRepos(repos)
      // Auto-select all repos
      setSelectedRepos(new Set(repos.map(r => r.path)))
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

  const handleCreateAgents = async () => {
    if (selectedRepos.size === 0) {
      setError('Please select at least one repository')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const reposToCreate = discoveredRepos.filter(r => selectedRepos.has(r.path))
      const agents = await window.electronAPI.setupWizardBulkCreateAgents(reposToCreate)
      onComplete(agents)
    } catch (err) {
      console.error('Failed to create agents:', err)
      setError('Failed to create agents')
    } finally {
      setIsCreating(false)
    }
  }

  const handleGoBack = () => {
    setStep('path')
    setError(null)
  }

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="w-full max-w-2xl mx-auto px-4">
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
          {/* Step 1: Path Selection */}
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
                    {suggestedPaths.map((path) => (
                      <Button
                        key={path}
                        onClick={() => handleSelectSuggestedPath(path)}
                        variant={selectedPath === path ? 'default' : 'outline'}
                        size="sm"
                      >
                        {path.replace(process.env.HOME || '', '~')}
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
                  onClick={onSkip}
                  variant="ghost"
                >
                  Skip Setup
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

          {/* Step 2: Repository Selection */}
          {step === 'repos' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Select Repositories
                </h2>
                <p className="text-muted-foreground text-sm">
                  Found {discoveredRepos.length} {discoveredRepos.length === 1 ? 'repository' : 'repositories'}. Select which ones to add as agents.
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

              {/* Repository List */}
              <div className="border border-border rounded-md max-h-96 overflow-y-auto">
                {discoveredRepos.length === 0 ? (
                  <div className="p-8 text-center">
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
                  <div className="divide-y divide-border">
                    {discoveredRepos.map((repo) => {
                      const isSelected = selectedRepos.has(repo.path)
                      return (
                        <button
                          key={repo.path}
                          onClick={() => handleToggleRepo(repo.path)}
                          className="w-full px-4 py-3 flex items-start gap-3 hover:bg-accent transition-colors text-left"
                        >
                          <div className="pt-0.5">
                            {isSelected ? (
                              <CheckSquare className="h-5 w-5 text-primary" />
                            ) : (
                              <Square className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-foreground">
                              {repo.name}
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                              {repo.path}
                            </div>
                            {repo.remoteUrl && (
                              <div className="text-xs text-muted-foreground/80 truncate mt-1">
                                {repo.remoteUrl}
                              </div>
                            )}
                          </div>
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
                    onClick={handleCreateAgents}
                    disabled={isCreating || selectedRepos.size === 0}
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
              )}
            </div>
          )}
        </div>

        {/* Skip link at bottom */}
        {step === 'path' && (
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
