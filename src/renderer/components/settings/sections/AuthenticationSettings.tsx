import { useState, useEffect, useCallback } from 'react'
import { Check, X, RefreshCw, Trash2, Info, Save, AlertTriangle, Shield } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Label } from '@/renderer/components/ui/label'
import { Input } from '@/renderer/components/ui/input'

interface TokenScopeResult {
  valid: boolean
  scopes: string[]
  missingScopes: string[]
  ssoConfigured: boolean | null
  error?: string
}

export function AuthenticationSettings() {
  // Claude OAuth state
  const [hasToken, setHasToken] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [tokenCreatedAt, setTokenCreatedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // BuildBuddy API key state
  const [hasBuildBuddyKey, setHasBuildBuddyKey] = useState(false)
  const [newBuildBuddyKey, setNewBuildBuddyKey] = useState('')
  const [savingBuildBuddyKey, setSavingBuildBuddyKey] = useState(false)

  // GitHub token state
  const [hasGitHubToken, setHasGitHubToken] = useState(false)
  const [newGitHubToken, setNewGitHubToken] = useState('')
  const [savingGitHubToken, setSavingGitHubToken] = useState(false)
  const [detectingGitHubToken, setDetectingGitHubToken] = useState(false)
  const [gitHubTokenDetectResult, setGitHubTokenDetectResult] = useState<{ success: boolean; source: string | null; reason?: string } | null>(null)

  // Token scope checking state
  const [scopeResult, setScopeResult] = useState<TokenScopeResult | null>(null)
  const [checkingScopes, setCheckingScopes] = useState(false)

  const checkScopes = useCallback(async () => {
    setCheckingScopes(true)
    try {
      const result = await window.electronAPI.checkGitHubTokenScopes()
      setScopeResult(result)
    } catch (err) {
      console.error('Failed to check token scopes:', err)
    } finally {
      setCheckingScopes(false)
    }
  }, [])

  // Load token status on mount
  useEffect(() => {
    checkTokenStatus()
  }, [])

  // Auto-check scopes when GitHub token is present
  useEffect(() => {
    if (hasGitHubToken) {
      checkScopes()
    } else {
      setScopeResult(null)
    }
  }, [hasGitHubToken, checkScopes])

  const checkTokenStatus = async () => {
    try {
      const [oauthConfigured, gitHubConfigured, buildBuddyConfigured] = await Promise.all([
        window.electronAPI.hasOAuthToken(),
        window.electronAPI.hasGitHubToken(),
        window.electronAPI.hasBuildBuddyApiKey(),
      ])
      setHasToken(oauthConfigured)
      setHasGitHubToken(gitHubConfigured)
      setHasBuildBuddyKey(buildBuddyConfigured)
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
      // Always re-check scopes after saving (hasGitHubToken may already be true)
      checkScopes()
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
      setScopeResult(null)
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
        // Always re-check scopes after detect (hasGitHubToken may already be true)
        checkScopes()
      }
    } catch (error) {
      console.error('Failed to detect GitHub token:', error)
      setGitHubTokenDetectResult({ success: false, source: null })
    } finally {
      setDetectingGitHubToken(false)
    }
  }

  // BuildBuddy API key handlers
  const handleSaveBuildBuddyKey = async () => {
    if (!newBuildBuddyKey.trim()) return

    setSavingBuildBuddyKey(true)
    try {
      await window.electronAPI.setBuildBuddyApiKey(newBuildBuddyKey.trim())
      setNewBuildBuddyKey('')
      setHasBuildBuddyKey(true)
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save BuildBuddy API key:', error)
    } finally {
      setSavingBuildBuddyKey(false)
    }
  }

  const handleClearBuildBuddyKey = async () => {
    try {
      await window.electronAPI.clearBuildBuddyApiKey()
      setHasBuildBuddyKey(false)
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to clear BuildBuddy API key:', error)
    }
  }

  const hasWarnings = scopeResult && (scopeResult.missingScopes.length > 0 || scopeResult.ssoConfigured === false || scopeResult.error)
  const hasErrors = scopeResult && (scopeResult.error || !scopeResult.valid)

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
              hasErrors ? (
                <>
                  <X className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-red-600 dark:text-red-400 font-medium">Invalid</span>
                </>
              ) : hasWarnings ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">Missing scopes</span>
                </>
              ) : scopeResult ? (
                <>
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600 dark:text-green-400 font-medium">Configured</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600 dark:text-green-400 font-medium">Configured</span>
                </>
              )
            ) : (
              <>
                <X className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Not configured</span>
              </>
            )}
          </div>
        </div>

        {/* Token scope warnings */}
        {hasGitHubToken && scopeResult && (
          <>
            {scopeResult.error ? (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                <div className="flex gap-2">
                  <X className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-600 dark:text-red-400">
                    <p className="font-medium">{scopeResult.error}</p>
                    {scopeResult.error.includes('expired') && (
                      <p className="text-xs mt-1 text-muted-foreground">
                        Generate a new token at{' '}
                        <button
                          onClick={() => window.electronAPI.openExternal('https://github.com/settings/tokens')}
                          className="text-blue-500 hover:underline cursor-pointer"
                        >
                          github.com/settings/tokens
                        </button>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : scopeResult.missingScopes.length > 0 ? (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                <div className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-600 dark:text-amber-400">
                    <p className="font-medium">Token is missing required scopes</p>
                    <div className="mt-2 space-y-1">
                      {scopeResult.missingScopes.map(scope => (
                        <div key={scope} className="flex items-center gap-1.5 text-xs">
                          <X className="h-3 w-3" />
                          <code className="bg-muted px-1 rounded">{scope}</code>
                          {scope === 'repo' && <span className="text-muted-foreground">— required for creating PRs</span>}
                          {scope === 'read:packages' && <span className="text-muted-foreground">— recommended for accessing organization packages</span>}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs mt-2 text-muted-foreground">
                      Headless agents may fail to create PRs or access private packages without these scopes.{' '}
                      <button
                        onClick={() => window.electronAPI.openExternal('https://github.com/settings/tokens')}
                        className="text-blue-500 hover:underline cursor-pointer"
                      >
                        Update token scopes
                      </button>
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                <div className="flex gap-2">
                  <Shield className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-green-600 dark:text-green-400">
                    <p>
                      <strong>Token verified</strong> — has required scopes: {scopeResult.scopes.join(', ')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {scopeResult.ssoConfigured === false && !scopeResult.error && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                <div className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-600 dark:text-amber-400">
                    <p className="font-medium">SSO authorization may be required</p>
                    <p className="text-xs mt-1 text-muted-foreground">
                      Your token may not be authorized for SAML SSO organizations. Authorize it at{' '}
                      <button
                        onClick={() => window.electronAPI.openExternal('https://github.com/settings/tokens')}
                        className="text-blue-500 hover:underline cursor-pointer"
                      >
                        github.com/settings/tokens
                      </button>
                      {' '}by clicking "Configure SSO" next to the token.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Re-check button */}
            <Button
              onClick={checkScopes}
              variant="outline"
              size="sm"
              disabled={checkingScopes}
              data-testid="recheck-scopes-button"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${checkingScopes ? 'animate-spin' : ''}`} />
              {checkingScopes ? 'Checking...' : 'Re-check token'}
            </Button>
          </>
        )}

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
              {' '}with <code className="bg-muted px-1 rounded">repo</code> and <code className="bg-muted px-1 rounded">read:packages</code> scopes.
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

      {/* BuildBuddy API Key Section */}
      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">BuildBuddy API Key</Label>
            <p className="text-sm text-muted-foreground">
              Used for <code className="bg-muted px-1 rounded text-xs">bb</code> CLI and BuildBuddy MCP server authentication
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasBuildBuddyKey ? (
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

        {/* Manual entry */}
        <div className="space-y-2">
          <Label htmlFor="buildbuddy-key">API Key</Label>
          <div className="flex gap-2">
            <Input
              id="buildbuddy-key"
              type="password"
              placeholder={hasBuildBuddyKey ? '••••••••' : 'Enter BuildBuddy API key'}
              value={newBuildBuddyKey}
              onChange={(e) => setNewBuildBuddyKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveBuildBuddyKey()
                }
              }}
            />
            <Button
              onClick={handleSaveBuildBuddyKey}
              disabled={!newBuildBuddyKey.trim() || savingBuildBuddyKey}
            >
              <Save className="h-4 w-4 mr-2" />
              {savingBuildBuddyKey ? 'Saving...' : 'Save'}
            </Button>
            {hasBuildBuddyKey && (
              <Button
                onClick={handleClearBuildBuddyKey}
                variant="outline"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Info box */}
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
          <div className="flex gap-2">
            <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-600 dark:text-blue-400">
              <strong>What is this?</strong> The BuildBuddy API key is used to authenticate the <code className="bg-muted px-1 rounded">bb</code> CLI tool and the BuildBuddy MCP server in Docker containers. It is passed via the <code className="bg-muted px-1 rounded">BUILDBUDDY_API_KEY</code> environment variable. If the key is set in your shell environment, it will take precedence over the stored value.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
