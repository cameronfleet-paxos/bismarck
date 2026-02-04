import { useState, useEffect } from 'react'
import { Download, X, RotateCcw, RefreshCw } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import type { UpdateStatus } from '@/renderer/electron.d'

/**
 * Floating notification banner for update status.
 * Appears in the bottom-right corner when:
 * - An update is available
 * - An update is downloading
 * - An update has been downloaded and is ready to install
 */
export function UpdateNotificationBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Get initial status
    window.electronAPI.getUpdateStatus().then(setStatus)

    // Listen for status updates
    window.electronAPI.onUpdateStatus((newStatus) => {
      setStatus(newStatus)
      // Reset dismissed state when a new update becomes available or downloaded
      if (newStatus.state === 'available' || newStatus.state === 'downloaded') {
        setDismissed(false)
      }
    })

    return () => {
      window.electronAPI.removeUpdateStatusListener()
    }
  }, [])

  const handleDismiss = () => {
    setDismissed(true)
  }

  const handleDownload = async () => {
    try {
      await window.electronAPI.downloadUpdate()
    } catch (error) {
      console.error('Failed to download update:', error)
    }
  }

  const handleInstall = async () => {
    try {
      await window.electronAPI.installUpdate()
    } catch (error) {
      console.error('Failed to install update:', error)
    }
  }

  // Don't show banner for these states
  if (
    dismissed ||
    status.state === 'idle' ||
    status.state === 'checking' ||
    status.state === 'not-available' ||
    status.state === 'error'
  ) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-card border shadow-lg rounded-lg p-4 max-w-sm">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0 mt-0.5">
            {status.state === 'downloading' ? (
              <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />
            ) : status.state === 'downloaded' ? (
              <Download className="h-5 w-5 text-green-500" />
            ) : (
              <Download className="h-5 w-5 text-blue-500" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {status.state === 'available' && (
              <>
                <h4 className="font-medium text-sm">Update Available</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Version {status.version} is ready to download
                </p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={handleDownload}>
                    Download
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleDismiss}>
                    Later
                  </Button>
                </div>
              </>
            )}

            {status.state === 'downloading' && (
              <>
                <h4 className="font-medium text-sm">Downloading Update</h4>
                <div className="mt-2">
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${status.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {Math.round(status.progress)}% complete
                  </p>
                </div>
              </>
            )}

            {status.state === 'downloaded' && (
              <>
                <h4 className="font-medium text-sm">Ready to Update</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Version {status.version} has been downloaded
                </p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={handleInstall}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Restart Now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleDismiss}>
                    Later
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Dismiss button (only for downloading state) */}
          {status.state === 'downloading' && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 -mr-1 -mt-1"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
