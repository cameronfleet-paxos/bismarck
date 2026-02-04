import { useState, useEffect } from 'react'
import { Check, Download, RefreshCw, RotateCcw } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Button } from '@/renderer/components/ui/button'
import { Switch } from '@/renderer/components/ui/switch'
import type { UpdateStatus } from '@/renderer/electron.d'

interface UpdatesSettingsProps {
  onSettingsChange?: () => void
}

export function UpdatesSettings({ onSettingsChange }: UpdatesSettingsProps) {
  const [autoCheck, setAutoCheck] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [showSaved, setShowSaved] = useState(false)

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

    // Listen for update status changes
    window.electronAPI.onUpdateStatus((status) => {
      setUpdateStatus(status)
    })

    return () => {
      window.electronAPI.removeUpdateStatusListener()
    }
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
      await window.electronAPI.checkForUpdates()
    } catch (error) {
      console.error('Failed to check for updates:', error)
      setUpdateStatus({ state: 'error', message: 'Failed to check for updates' })
    }
  }

  const handleDownloadUpdate = async () => {
    try {
      await window.electronAPI.downloadUpdate()
    } catch (error) {
      console.error('Failed to download update:', error)
      setUpdateStatus({ state: 'error', message: 'Failed to download update' })
    }
  }

  const handleInstallUpdate = async () => {
    try {
      await window.electronAPI.installUpdate()
    } catch (error) {
      console.error('Failed to install update:', error)
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

      case 'not-available':
        return (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check className="h-4 w-4" />
            You're on the latest version
          </div>
        )

      case 'available':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
              <Download className="h-4 w-4" />
              Version {updateStatus.version} is available
            </div>
            <Button onClick={handleDownloadUpdate} size="sm">
              <Download className="h-4 w-4 mr-2" />
              Download Update
            </Button>
          </div>
        )

      case 'downloading':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Download className="h-4 w-4 animate-pulse" />
              Downloading update...
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${updateStatus.progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {Math.round(updateStatus.progress)}% complete
            </p>
          </div>
        )

      case 'downloaded':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <Check className="h-4 w-4" />
              Version {updateStatus.version} is ready to install
            </div>
            <Button onClick={handleInstallUpdate} size="sm">
              <RotateCcw className="h-4 w-4 mr-2" />
              Restart to Update
            </Button>
            <p className="text-xs text-muted-foreground">
              The app will restart automatically to apply the update.
            </p>
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
        <span className="font-mono text-sm bg-muted px-3 py-1.5 rounded-md">
          v{appVersion}
        </span>
      </div>

      {/* Auto Check Toggle */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">Automatic Updates</Label>
          <p className="text-sm text-muted-foreground">
            Check for updates automatically on launch
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
            disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
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
