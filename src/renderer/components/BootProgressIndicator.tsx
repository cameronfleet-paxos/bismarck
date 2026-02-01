import { Loader2 } from 'lucide-react'

interface BootProgressIndicatorProps {
  queued: number
  active: number
}

export function BootProgressIndicator({ queued, active }: BootProgressIndicatorProps) {
  const total = queued + active

  if (total === 0) return null

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>
        Booting {active}/{total} terminals
      </span>
    </div>
  )
}
