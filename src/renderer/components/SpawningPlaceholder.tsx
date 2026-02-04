import { Loader2 } from 'lucide-react'
import { AgentIcon } from './AgentIcon'
import type { Agent, SpawningHeadlessInfo } from '@/shared/types'
import { themes } from '@/shared/constants'

interface SpawningPlaceholderProps {
  info: SpawningHeadlessInfo
  referenceAgent?: Agent  // Optional - fallback to info metadata if not available
}

export function SpawningPlaceholder({ info, referenceAgent }: SpawningPlaceholderProps) {
  // Use reference agent if available, otherwise fall back to stored metadata
  const theme = referenceAgent?.theme ?? info.referenceTheme
  const icon = referenceAgent?.icon ?? info.referenceIcon
  const name = referenceAgent?.name ?? info.referenceName

  const themeColors = themes[theme]

  return (
    <div className="rounded-lg border overflow-hidden h-full flex flex-col">
      {/* Header matching headless terminal header */}
      <div className="px-3 py-1.5 border-b bg-card text-sm font-medium flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AgentIcon icon={icon} className="w-4 h-4" />
          <span>{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            info.model === 'opus' ? 'bg-purple-500/20 text-purple-400' :
            'bg-blue-500/20 text-blue-400'
          }`}>
            {info.model === 'opus' ? 'Opus' : 'Sonnet'}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
            starting
          </span>
        </div>
      </div>

      {/* Loading content area */}
      <div
        className="flex-1 flex flex-col items-center justify-center gap-4 min-h-[200px]"
        style={{ backgroundColor: themeColors.bg }}
      >
        <Loader2
          className="h-8 w-8 animate-spin"
          style={{ color: themeColors.fg }}
        />
        <div className="text-sm" style={{ color: themeColors.fg, opacity: 0.7 }}>
          Starting headless agent...
        </div>
      </div>
    </div>
  )
}
