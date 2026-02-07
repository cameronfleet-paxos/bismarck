import { useElapsedTime } from '@/renderer/hooks/useElapsedTime'

interface ElapsedTimeProps {
  startedAt: string
  completedAt?: string
}

export function ElapsedTime({ startedAt, completedAt }: ElapsedTimeProps) {
  const elapsed = useElapsedTime(startedAt, completedAt)

  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {elapsed}
    </span>
  )
}
