import { useState, useEffect } from 'react'
import { Check, RefreshCw, ExternalLink, Copy } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Button } from '@/renderer/components/ui/button'
import { Switch } from '@/renderer/components/ui/switch'
import type { UpdateStatus } from '@/renderer/electron.d'

interface UpdatesSettingsProps {
  onSettingsChange?: () => void
}

const INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/cameronfleet-paxos/bismarck/main/install.sh | bash'

export function UpdatesSettings({ onSettingsChange }: UpdatesSettingsProps) {
  const [autoCheck, setAutoCheck] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [showSaved, setShowSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  // Load settings and version on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [settings, version, status] = await Promise.all([
          window.electronAPI.getUpdateSettings(),
          window.electronAPI.getAppVersion(),
          window.electronAPI.getUpdateStatus(),
        ])
        setAutoCheck(settings.autoCheck)
        setAppVersion(version)
        setUpdateStatus(status)
      } catch (error) {
        console.error('Failed to load update settings:', error)
      }
    }

    loadData()
  }, [])

  const showSavedIndicator = () => {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const handleAutoCheckChange = async (enabled: boolean) => {
    setAutoCheck(enabled)
    try {
      await window.electronAPI.setUpdateSettings({ autoCheck: enabled })
      showSavedIndicator()
      onSettingsChange?.()
    } catch (error) {
      console.error('Failed to save update settings:', error)
    }
  }

  const handleCheckForUpdates = async () => {
    try {
      setUpdateStatus({ state: 'checking' })
      const status = await window.electronAPI.checkForUpdates()
      setUpdateStatus(status)
    } catch (error) {
      console.error('Failed to check for updates:', error)
      setUpdateStatus({ state: 'error', message: 'Failed to check for updates' })
    }
  }

  const handleCopyCommand = async () => {
    try {
      await window.electronAPI.copyToClipboard(INSTALL_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleOpenGitHub = async () => {
    if (updateStatus.state === 'available') {
      await window.electronAPI.openExternal(updateStatus.releaseUrl)
    }
  }

  const renderStatusContent = () => {
    switch (updateStatus.state) {
      case 'idle':
        return (
          <p className="text-sm text-muted-foreground">
            Click "Check for Updates" to see if a new version is available.
          </p>
        )

      case 'checking':
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Checking for updates...
          </div>
        )

      case 'up-to-date':
        return (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check className="h-4 w-4" />
            You're on the latest version
          </div>
        )

      case 'available':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-blue-600 dark:text-blue-400">
                Version {updateStatus.version} is available!
              </span>
              <button
                onClick={handleOpenGitHub}
                className="text-blue-500 hover:text-blue-400 hover:underline flex items-center gap-1"
              >
                Release notes
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                To update, quit Bismarck and run this command in your terminal:
              </p>

              <div className="relative">
                <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto pr-12">
                  {INSTALL_COMMAND}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute right-1 top-1 h-8 w-8 p-0"
                  onClick={handleCopyCommand}
                  title="Copy command"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyCommand}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-2 text-green-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Command
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenGitHub}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View on GitHub
                </Button>
              </div>
            </div>
          </div>
        )

      case 'error':
        return (
          <div className="space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400">
              Error: {updateStatus.message}
            </p>
            <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
              Try Again
            </Button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-medium">Updates</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Keep Bismarck up to date with the latest features and fixes
        </p>
      </div>

      {/* Current Version */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">Current Version</Label>
          <p className="text-sm text-muted-foreground">
            The version you're currently running
          </p>
        </div>
        <button
          onClick={() => window.electronAPI.openExternal(
            `https://github.com/cameronfleet-paxos/bismarck/releases/tag/v${appVersion}`
          )}
          className="font-mono text-sm bg-muted px-3 py-1.5 rounded-md hover:bg-muted/80 transition-colors cursor-pointer flex items-center gap-1.5 text-blue-500 hover:text-blue-400"
          title="View release notes on GitHub"
        >
          v{appVersion}
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Auto Check Toggle */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">Check on Startup</Label>
          <p className="text-sm text-muted-foreground">
            Automatically check for updates when Bismarck launches
          </p>
        </div>
        <Switch
          checked={autoCheck}
          onCheckedChange={handleAutoCheckChange}
        />
      </div>

      {/* Check for Updates Section */}
      <div className="border-t pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Check for Updates</Label>
            <p className="text-sm text-muted-foreground">
              Manually check if a new version is available
            </p>
          </div>
          <Button
            onClick={handleCheckForUpdates}
            variant="outline"
            disabled={updateStatus.state === 'checking'}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${updateStatus.state === 'checking' ? 'animate-spin' : ''}`} />
            Check Now
          </Button>
        </div>

        {/* Status Display */}
        <div className="p-4 bg-muted/30 rounded-lg">
          {renderStatusContent()}
        </div>
      </div>
    </div>
  )
}
