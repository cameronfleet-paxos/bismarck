import { useState, useEffect } from 'react'
import { Check, X, RefreshCw, Trash2, Info } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Label } from '@/renderer/components/ui/label'

export function AuthenticationSettings() {
  const [hasToken, setHasToken] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [tokenCreatedAt, setTokenCreatedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load token status on mount
  useEffect(() => {
    checkTokenStatus()
  }, [])

  const checkTokenStatus = async () => {
    try {
      const configured = await window.electronAPI.hasOAuthToken()
      setHasToken(configured)
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
          Manage Claude API credentials for headless agents
        </p>
      </div>

      {/* Token Status Section */}
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
    </div>
  )
}
