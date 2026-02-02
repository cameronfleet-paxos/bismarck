/**
 * Example usage of ProxiedToolsSettings component
 *
 * This component can be integrated into a settings page like this:
 */

import { ProxiedToolsSettings } from './ProxiedToolsSettings'
import { useState, useEffect } from 'react'
import type { AppSettings } from '@/main/settings-manager'

export function ExampleSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const loaded = await window.electronAPI.getSettings()
      setSettings(loaded)
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading || !settings) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6">
      <ProxiedToolsSettings
        tools={settings.docker.proxiedTools}
        onToolAdded={loadSettings}
        onToolRemoved={loadSettings}
      />
    </div>
  )
}
