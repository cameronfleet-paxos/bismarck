import { useState, useEffect } from 'react'
import { Check, X, RefreshCw, Trash2, Info, Save } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Label } from '@/renderer/components/ui/label'
import { Input } from '@/renderer/components/ui/input'

export function AuthenticationSettings() {
  // Claude OAuth state
  const [hasToken, setHasToken] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [tokenCreatedAt, setTokenCreatedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // GitHub token state
  const [hasGitHubToken, setHasGitHubToken] = useState(false)
  const [newGitHubToken, setNewGitHubToken] = useState('')
  const [savingGitHubToken, setSavingGitHubToken] = useState(false)
  const [detectingGitHubToken, setDetectingGitHubToken] = useState(false)
  const [gitHubTokenDetectResult, setGitHubTokenDetectResult] = useState<{ success: boolean; source: string | null; reason?: string } | null>(null)

  // Load token status on mount
  useEffect(() => {
    checkTokenStatus()
  }, [])

  const checkTokenStatus = async () => {
    try {
      const [oauthConfigured, gitHubConfigured] = await Promise.all([
        window.electronAPI.hasOAuthToken(),
        window.electronAPI.hasGitHubToken(),
      ])
      setHasToken(oauthConfigured)
      setHasGitHubToken(gitHubConfigured)
      // Note: We don't have token creation timestamp - the API returns just the token string
      setTokenCreatedAt(null)
    } catch (err) {
      console.error('Failed to check token status:', err)
    }
  }

  const handleRefreshToken = async () => {
    setIsRefreshing(true)
    setError(null)
    try {
      // runOAuthSetup returns the token string on success, throws on failure
      await window.electronAPI.runOAuthSetup()
      await checkTokenStatus()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (err) {
      setError(`OAuth setup failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleClearToken = async () => {
    try {
      await window.electronAPI.clearOAuthToken()
      setHasToken(false)
      setTokenCreatedAt(null)
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (err) {
      console.error('Failed to clear token:', err)
      setError(`Failed to clear token: ${err}`)
    }
  }

  // GitHub token handlers
  const handleSaveGitHubToken = async () => {
    if (!newGitHubToken.trim()) return

    setSavingGitHubToken(true)
    try {
      await window.electronAPI.setGitHubToken(newGitHubToken.trim())
      setNewGitHubToken('')
      setHasGitHubToken(true)
      setGitHubTokenDetectResult(null)
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save GitHub token:', error)
    } finally {
      setSavingGitHubToken(false)
    }
  }

  const handleClearGitHubToken = async () => {
    try {
      await window.electronAPI.clearGitHubToken()
      setHasGitHubToken(false)
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to clear GitHub token:', error)
    }
  }

  const handleAutoDetectGitHubToken = async () => {
    setDetectingGitHubToken(true)
    setGitHubTokenDetectResult(null)
    try {
      const result = await window.electronAPI.setupWizardDetectAndSaveGitHubToken()
      setGitHubTokenDetectResult(result)
      if (result.success) {
        setHasGitHubToken(true)
        setShowSaved(true)
        setTimeout(() => setShowSaved(false), 2000)
      }
    } catch (error) {
      console.error('Failed to detect GitHub token:', error)
      setGitHubTokenDetectResult({ success: false, source: null })
    } finally {
      setDetectingGitHubToken(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-medium">Authentication</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Manage API credentials for headless agents and GitHub
        </p>
      </div>

      {/* Claude OAuth Token Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Claude OAuth Token</Label>
            <p className="text-sm text-muted-foreground">
              Used to authenticate headless agents with Claude API
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasToken ? (
              <>
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                  Configured
                </span>
              </>
            ) : (
              <>
                <X className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Not configured
                </span>
              </>
            )}
          </div>
        </div>

        {tokenCreatedAt && (
          <div className="text-xs text-muted-foreground">
            Created: {tokenCreatedAt}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleRefreshToken}
            disabled={isRefreshing}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh Token'}
          </Button>
          {hasToken && (
            <Button
              onClick={handleClearToken}
              variant="outline"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Token
            </Button>
          )}
        </div>

        {/* Info Box */}
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
          <div className="flex gap-2">
            <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-600 dark:text-blue-400">
              <p className="mb-2">
                <strong>What is this?</strong> This OAuth token authenticates headless agents
                (Plans, Ralph Loops) with the Claude API.
              </p>
              <p>
                <strong>Refreshing</strong> will open a browser window for you to complete
                the OAuth login flow. The token is then automatically saved and used by
                all headless agents.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* GitHub Token Section */}
      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">GitHub Token</Label>
            <p className="text-sm text-muted-foreground">
              Used for <code className="bg-muted px-1 rounded text-xs">gh</code> CLI authentication with SAML SSO organizations
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasGitHubToken ? (
              <>
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm text-green-600 dark:text-green-400 font-medium">Configured</span>
              </>
            ) : (
              <>
                <X className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Not configured</span>
              </>
            )}
          </div>
        </div>

        {/* Auto-detect button */}
        <div className="space-y-4">
          <div>
            <Button
              onClick={handleAutoDetectGitHubToken}
              variant="outline"
              disabled={detectingGitHubToken}
            >
              {detectingGitHubToken ? (
                <>
                  <span className="animate-spin mr-2">...</span>
                  Detecting...
                </>
              ) : (
                'Auto-detect from environment'
              )}
            </Button>
            {gitHubTokenDetectResult && (
              gitHubTokenDetectResult.success ? (
                <p className="text-sm mt-2 text-green-600 dark:text-green-400">
                  Token detected from {gitHubTokenDetectResult.source} and saved
                </p>
              ) : (
                <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                  <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                    {gitHubTokenDetectResult.reason === 'command_substitution'
                      ? 'Token set via command'
                      : gitHubTokenDetectResult.reason === 'unresolved_ref'
                      ? 'Token references unresolved variable'
                      : 'No token found'}
                  </p>
                  {gitHubTokenDetectResult.reason === 'command_substitution' ? (
                    <p className="text-xs text-muted-foreground mt-2">
                      Token appears to be set via a command (e.g., <code className="bg-muted px-1 rounded">$(op ...)</code>).
                      For security, we can't execute shell commands. Paste your token below.
                    </p>
                  ) : gitHubTokenDetectResult.reason === 'unresolved_ref' ? (
                    <>
                      <p className="text-xs text-muted-foreground mt-2">
                        Found <code className="bg-muted px-1 rounded">GITHUB_TOKEN</code> in your shell profile,
                        but it references another variable that isn't exported.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        If it's set by a secrets manager (1Password, Doppler, etc.),
                        copy the token value and paste it below.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground mt-2">
                        To enable auto-detection, add to your shell profile (<code className="bg-muted px-1 rounded">~/.zshrc</code> or <code className="bg-muted px-1 rounded">~/.bashrc</code>):
                      </p>
                      <pre className="bg-zinc-800 text-zinc-100 p-2 rounded mt-2 text-xs font-mono overflow-x-auto">
                        export GITHUB_TOKEN="ghp_your_token_here"
                      </pre>
                      <p className="text-xs text-muted-foreground mt-2">
                        Then click "Auto-detect" again, or paste your token below.
                      </p>
                    </>
                  )}
                </div>
              )
            )}
          </div>

          {/* Manual entry */}
          <div className="space-y-2">
            <Label htmlFor="github-token">Manual Entry</Label>
            <div className="flex gap-2">
              <Input
                id="github-token"
                type="password"
                placeholder={hasGitHubToken ? '••••••••' : 'ghp_xxxxxxxxxxxx'}
                value={newGitHubToken}
                onChange={(e) => setNewGitHubToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveGitHubToken()
                  }
                }}
              />
              <Button
                onClick={handleSaveGitHubToken}
                disabled={!newGitHubToken.trim() || savingGitHubToken}
              >
                <Save className="h-4 w-4 mr-2" />
                {savingGitHubToken ? 'Saving...' : 'Save'}
              </Button>
              {hasGitHubToken && (
                <Button
                  onClick={handleClearGitHubToken}
                  variant="outline"
                >
                  Clear
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Generate a token at{' '}
              <button
                onClick={() => window.electronAPI.openExternal('https://github.com/settings/tokens')}
                className="text-blue-500 hover:underline cursor-pointer"
              >
                github.com/settings/tokens
              </button>
              {' '}with <code className="bg-muted px-1 rounded">repo</code> scope.
            </p>
          </div>

          {/* Info box */}
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
            <div className="flex gap-2">
              <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                <strong>When to use:</strong> If you're getting SAML SSO errors when creating PRs for organization repositories, you need to configure a token here. The token is passed to <code className="bg-muted px-1 rounded">gh</code> commands via the <code className="bg-muted px-1 rounded">GITHUB_TOKEN</code> environment variable.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
