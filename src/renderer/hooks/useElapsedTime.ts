import { useState, useEffect, useRef } from 'react'

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function useElapsedTime(startedAt: string, completedAt?: string): string {
  const [now, setNow] = useState(() => Date.now())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isRunning = !completedAt

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => setNow(Date.now()), 1000)
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }
  }, [isRunning])

  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : now
  const elapsed = Math.max(0, end - start)

  return formatDuration(elapsed)
}
