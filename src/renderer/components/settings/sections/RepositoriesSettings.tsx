import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, X, Check, ExternalLink, Copy, ClipboardPaste, Zap, MessageSquare, GitBranch } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Textarea } from '@/renderer/components/ui/textarea'
import { Label } from '@/renderer/components/ui/label'
import type { Repository } from '@/shared/types'

// Convert git remote URL to GitHub web URL
function getGitHubUrlFromRemote(remoteUrl: string): string | null {
  const sshMatch = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/)
  if (sshMatch) return `https://github.com/${sshMatch[1]}`
  const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`
  return null
}

interface RepositoriesSettingsProps {
  onSettingsChange: () => void
}

interface RepoEditState {
  purpose: string
  completionCriteria: string
  protectedBranches: string
  guidance: string
}

type SavedField = 'purpose' | 'completionCriteria' | 'protectedBranches' | 'guidance'

export function RepositoriesSettings({ onSettingsChange }: RepositoriesSettingsProps) {
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
  const [repoEdits, setRepoEdits] = useState<Record<string, RepoEditState>>({})
  const [savedFields, setSavedFields] = useState<Record<string, Set<SavedField>>>({})
  const [newRepoPath, setNewRepoPath] = useState('')
  const [addingRepo, setAddingRepo] = useState(false)
  const [addRepoError, setAddRepoError] = useState<string | null>(null)
  const [exportedRepoId, setExportedRepoId] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importedRepoId, setImportedRepoId] = useState<string | null>(null)

  const saveTimeouts = useRef<Record<string, NodeJS.Timeout>>({})

  useEffect(() => {
    loadRepositories()
    return () => {
      Object.values(saveTimeouts.current).forEach(clearTimeout)
    }
  }, [])

  const loadRepositories = async () => {
    setLoading(true)
    try {
      const repos = await window.electronAPI.getRepositories()
      setRepositories(repos)
      // Auto-select first repo if none selected
      if (repos.length > 0 && !selectedRepoId) {
        setSelectedRepoId(repos[0].id)
        initEditStateForRepo(repos[0])
      }
    } catch (error) {
      console.error('Failed to load repositories:', error)
    } finally {
      setLoading(false)
    }
  }

  const initEditStateForRepo = useCallback((repo: Repository) => {
    setRepoEdits(prev => ({
      ...prev,
      [repo.id]: {
        purpose: repo.purpose || '',
        completionCriteria: repo.completionCriteria || '',
        protectedBranches: repo.protectedBranches?.join(', ') || '',
        guidance: repo.guidance || '',
      }
    }))
  }, [])

  const selectRepo = useCallback((repoId: string) => {
    setSelectedRepoId(repoId)
    setImportError(null)
    const repo = repositories.find(r => r.id === repoId)
    if (repo && !repoEdits[repoId]) {
      initEditStateForRepo(repo)
    }
  }, [repositories, repoEdits, initEditStateForRepo])

  const showFieldSaved = useCallback((repoId: string, field: SavedField) => {
    setSavedFields(prev => {
      const repoFields = new Set(prev[repoId] || [])
      repoFields.add(field)
      return { ...prev, [repoId]: repoFields }
    })
    setTimeout(() => {
      setSavedFields(prev => {
        const repoFields = new Set(prev[repoId] || [])
        repoFields.delete(field)
        return { ...prev, [repoId]: repoFields }
      })
    }, 1500)
  }, [])

  const handleFieldBlur = useCallback(async (repoId: string, field: SavedField) => {
    const edit = repoEdits[repoId]
    if (!edit) return

    const repo = repositories.find(r => r.id === repoId)
    if (!repo) return

    let hasChanged = false
    const updates: Partial<Pick<Repository, 'purpose' | 'completionCriteria' | 'protectedBranches' | 'guidance'>> = {}

    if (field === 'purpose') {
      const original = repo.purpose || ''
      if (edit.purpose !== original) {
        hasChanged = true
        updates.purpose = edit.purpose || undefined
      }
    } else if (field === 'completionCriteria') {
      const original = repo.completionCriteria || ''
      if (edit.completionCriteria !== original) {
        hasChanged = true
        updates.completionCriteria = edit.completionCriteria || undefined
      }
    } else if (field === 'protectedBranches') {
      const original = repo.protectedBranches?.join(', ') || ''
      if (edit.protectedBranches !== original) {
        hasChanged = true
        const branches = edit.protectedBranches
          .split(',')
          .map(b => b.trim())
          .filter(b => b.length > 0)
        updates.protectedBranches = branches.length > 0 ? branches : undefined
      }
    } else if (field === 'guidance') {
      const original = repo.guidance || ''
      if (edit.guidance !== original) {
        hasChanged = true
        updates.guidance = edit.guidance || undefined
      }
    }

    if (!hasChanged) return

    const timeoutKey = `${repoId}-${field}`
    if (saveTimeouts.current[timeoutKey]) {
      clearTimeout(saveTimeouts.current[timeoutKey])
    }

    saveTimeouts.current[timeoutKey] = setTimeout(async () => {
      try {
        await window.electronAPI.updateRepository(repoId, updates)
        // Silently refresh repo data without triggering parent reload
        // (parent reload unmounts this component and loses selection state)
        const repos = await window.electronAPI.getRepositories()
        setRepositories(repos)
        showFieldSaved(repoId, field)
      } catch (error) {
        console.error(`Failed to save ${field}:`, error)
      }
    }, 300)
  }, [repoEdits, repositories, showFieldSaved])

  const updateEdit = useCallback((repoId: string, field: keyof RepoEditState, value: string) => {
    setRepoEdits(prev => ({
      ...prev,
      [repoId]: {
        ...prev[repoId],
        [field]: value,
      }
    }))
  }, [])

  const handleAddRepository = async () => {
    if (!newRepoPath.trim()) return
    setAddingRepo(true)
    setAddRepoError(null)
    try {
      const repo = await window.electronAPI.addRepository(newRepoPath.trim())
      if (repo) {
        const repos = await window.electronAPI.getRepositories()
        setRepositories(repos)
        setNewRepoPath('')
        // Select the newly added repo
        setSelectedRepoId(repo.id)
        initEditStateForRepo(repo)
        onSettingsChange()
      } else {
        setAddRepoError('Not a valid git repository')
      }
    } catch (error) {
      setAddRepoError(`Failed to add repository: ${error}`)
    } finally {
      setAddingRepo(false)
    }
  }

  const handleRemoveRepository = async (repoId: string) => {
    try {
      await window.electronAPI.removeRepository(repoId)
      const repos = await window.electronAPI.getRepositories()
      setRepositories(repos)
      // If we removed the selected repo, select the first remaining one
      if (selectedRepoId === repoId) {
        setSelectedRepoId(repos.length > 0 ? repos[0].id : null)
        if (repos.length > 0) initEditStateForRepo(repos[0])
      }
      onSettingsChange()
    } catch (error) {
      console.error('Failed to remove repository:', error)
    }
  }

  const handleExport = async (repo: Repository) => {
    const exportData = {
      purpose: repo.purpose || '',
      completionCriteria: repo.completionCriteria || '',
      protectedBranches: repo.protectedBranches || [],
      guidance: repo.guidance || '',
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2))
      setExportedRepoId(repo.id)
      setTimeout(() => setExportedRepoId(null), 1500)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleImport = async (repoId: string) => {
    setImportError(null)
    setImportedRepoId(null)
    try {
      const text = await navigator.clipboard.readText()
      const data = JSON.parse(text)

      const updates: Partial<Pick<Repository, 'purpose' | 'completionCriteria' | 'protectedBranches' | 'guidance'>> = {}

      if (data.purpose !== undefined) {
        if (typeof data.purpose !== 'string') {
          setImportError('Invalid "purpose" field - must be a string')
          return
        }
        updates.purpose = data.purpose || undefined
      }
      if (data.completionCriteria !== undefined) {
        if (typeof data.completionCriteria !== 'string') {
          setImportError('Invalid "completionCriteria" field - must be a string')
          return
        }
        updates.completionCriteria = data.completionCriteria || undefined
      }
      if (data.protectedBranches !== undefined) {
        if (!Array.isArray(data.protectedBranches) || !data.protectedBranches.every((b: unknown) => typeof b === 'string')) {
          setImportError('Invalid "protectedBranches" field - must be array of strings')
          return
        }
        updates.protectedBranches = data.protectedBranches.length > 0 ? data.protectedBranches : undefined
      }
      if (data.guidance !== undefined) {
        if (typeof data.guidance !== 'string') {
          setImportError('Invalid "guidance" field - must be a string')
          return
        }
        updates.guidance = data.guidance || undefined
      }

      if (Object.keys(updates).length === 0) {
        setImportError('No valid fields found in clipboard data')
        return
      }

      await window.electronAPI.updateRepository(repoId, updates)
      const repos = await window.electronAPI.getRepositories()
      setRepositories(repos)

      const updatedRepo = repos.find(r => r.id === repoId)
      if (updatedRepo) initEditStateForRepo(updatedRepo)

      setImportedRepoId(repoId)
      setTimeout(() => setImportedRepoId(null), 1500)
    } catch (error) {
      if (error instanceof SyntaxError) {
        setImportError('Invalid JSON format in clipboard')
      } else {
        setImportError('Failed to import settings')
      }
      console.error('Failed to import repo settings:', error)
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading repositories...</div>
  }

  const selectedRepo = repositories.find(r => r.id === selectedRepoId)
  const edit = selectedRepoId ? repoEdits[selectedRepoId] : null
  const repoSavedFields = selectedRepoId ? (savedFields[selectedRepoId] || new Set()) : new Set<SavedField>()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium mb-1">Repositories</h3>
        <p className="text-sm text-muted-foreground">
          Configure per-repo settings that control headless agent behavior
        </p>
      </div>

      {/* Add repository form */}
      <div className="flex gap-2">
        <Input
          placeholder="/path/to/your/repository"
          value={newRepoPath}
          onChange={(e) => {
            setNewRepoPath(e.target.value)
            setAddRepoError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddRepository()
          }}
          className="flex-1"
        />
        <Button
          onClick={handleAddRepository}
          disabled={!newRepoPath.trim() || addingRepo}
          size="sm"
        >
          <Plus className="h-4 w-4 mr-1" />
          {addingRepo ? 'Adding...' : 'Add'}
        </Button>
      </div>
      {addRepoError && (
        <p className="text-sm text-destructive">{addRepoError}</p>
      )}

      {repositories.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border rounded-lg">
          <p>No repositories found.</p>
          <p className="text-sm mt-2">
            Add a repository above or create agents with git-initialized directories.
          </p>
        </div>
      ) : (
        <div className="flex border rounded-lg overflow-hidden" style={{ minHeight: '560px' }}>
          {/* Repo list (left panel) */}
          <div className="w-52 flex-shrink-0 border-r bg-muted/20 overflow-y-auto">
            {repositories.map((repo) => (
              <button
                key={repo.id}
                onClick={() => selectRepo(repo.id)}
                className={`w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-colors ${
                  selectedRepoId === repo.id
                    ? 'bg-primary/10 border-l-2 border-l-primary'
                    : 'hover:bg-muted/50 border-l-2 border-l-transparent'
                }`}
              >
                <div className="font-medium text-sm truncate">{repo.name}</div>
                <div className="text-xs text-muted-foreground truncate">{repo.defaultBranch}</div>
              </button>
            ))}
          </div>

          {/* Detail panel (right) */}
          <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: 'none' }}>
            {selectedRepo && edit ? (
              <div className="space-y-6">
                {/* Repo header */}
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {selectedRepo.remoteUrl && getGitHubUrlFromRemote(selectedRepo.remoteUrl) ? (
                        <button
                          onClick={() => window.electronAPI.openExternal(getGitHubUrlFromRemote(selectedRepo.remoteUrl!)!)}
                          className="font-semibold text-base text-blue-500 hover:text-blue-400 hover:underline flex items-center gap-1"
                        >
                          {selectedRepo.name}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <div className="font-semibold text-base">{selectedRepo.name}</div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{selectedRepo.rootPath}</div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span>{selectedRepo.defaultBranch}</span>
                      {selectedRepo.remoteUrl && (
                        <span className="truncate font-mono">{selectedRepo.remoteUrl}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleExport(selectedRepo)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      title="Export settings to clipboard"
                    >
                      {exportedRepoId === selectedRepo.id ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleImport(selectedRepo.id)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      title="Import settings from clipboard"
                    >
                      {importedRepoId === selectedRepo.id ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <ClipboardPaste className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveRepository(selectedRepo.id)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      title="Remove repository"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {importError && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-md">
                    <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>
                  </div>
                )}

                {/* Divider */}
                <div className="border-t" />

                {/* Completion Criteria */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`completion-${selectedRepo.id}`} className="text-sm font-medium">Completion Criteria</Label>
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 font-medium">
                      <Zap className="h-3 w-3" />
                      Injected into standalone & PR-mode task agent prompts
                    </span>
                    {repoSavedFields.has('completionCriteria') && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 animate-in fade-in duration-200">
                        <Check className="h-3 w-3" />
                        Saved
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Agents validate work against these before creating PRs. They iterate until all criteria pass.
                  </p>
                  <Textarea
                    id={`completion-${selectedRepo.id}`}
                    placeholder="e.g., All tests pass, no lint errors, PR description includes test plan"
                    value={edit.completionCriteria}
                    onChange={(e) => updateEdit(selectedRepo.id, 'completionCriteria', e.target.value)}
                    onBlur={() => handleFieldBlur(selectedRepo.id, 'completionCriteria')}
                    rows={12}
                    className="min-h-[280px]"
                  />
                </div>

                {/* Agent Guidance */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`guidance-${selectedRepo.id}`} className="text-sm font-medium">Agent Guidance</Label>
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium">
                      <MessageSquare className="h-3 w-3" />
                      Injected as repo instructions
                    </span>
                    {repoSavedFields.has('guidance') && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 animate-in fade-in duration-200">
                        <Check className="h-3 w-3" />
                        Saved
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Added as REPOSITORY GUIDANCE section in all headless agent prompts. Use for conventions, build commands, or style requirements.
                  </p>
                  <Textarea
                    id={`guidance-${selectedRepo.id}`}
                    placeholder="e.g., Always run tests with --coverage, use feat/ branch prefix, prefer functional components"
                    value={edit.guidance}
                    onChange={(e) => updateEdit(selectedRepo.id, 'guidance', e.target.value)}
                    onBlur={() => handleFieldBlur(selectedRepo.id, 'guidance')}
                    rows={5}
                    className="min-h-[120px]"
                  />
                </div>

                {/* Protected Branches */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`protected-${selectedRepo.id}`} className="text-sm font-medium">Protected Branches</Label>
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 font-medium">
                      <GitBranch className="h-3 w-3" />
                      Controls PR base branch
                    </span>
                    {repoSavedFields.has('protectedBranches') && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 animate-in fade-in duration-200">
                        <Check className="h-3 w-3" />
                        Saved
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    First branch becomes --base for gh pr create. Falls back to default branch if empty.
                  </p>
                  <Input
                    id={`protected-${selectedRepo.id}`}
                    placeholder="main, master, production (comma-separated)"
                    value={edit.protectedBranches}
                    onChange={(e) => updateEdit(selectedRepo.id, 'protectedBranches', e.target.value)}
                    onBlur={() => handleFieldBlur(selectedRepo.id, 'protectedBranches')}
                  />
                </div>

                {/* Purpose */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`purpose-${selectedRepo.id}`} className="text-sm font-medium">Purpose</Label>
                    <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 font-medium">
                      <Zap className="h-3 w-3" />
                      Used for task allocation
                    </span>
                    {repoSavedFields.has('purpose') && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 animate-in fade-in duration-200">
                        <Check className="h-3 w-3" />
                        Saved
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Used by the orchestrator to determine which repo handles which tasks, and for grouping repos in the sidebar.
                  </p>
                  <Textarea
                    id={`purpose-${selectedRepo.id}`}
                    placeholder="What is this repository for?"
                    value={edit.purpose}
                    onChange={(e) => updateEdit(selectedRepo.id, 'purpose', e.target.value)}
                    onBlur={() => handleFieldBlur(selectedRepo.id, 'purpose')}
                    rows={4}
                    className="min-h-[100px]"
                  />
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <p className="text-sm">Select a repository to configure</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
