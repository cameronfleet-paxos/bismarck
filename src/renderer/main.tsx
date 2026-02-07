// Renderer startup benchmark - record script start immediately
const rendererStartTime = performance.now()

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Export timing utilities for App.tsx to use
export const benchmarkStartTime = rendererStartTime

export function sendTiming(label: string, startMs: number, durationMs: number): void {
  window.electronAPI?.sendBenchmarkTiming?.(label, 'renderer', startMs, durationMs)
}

export function sendMilestone(name: string): void {
  window.electronAPI?.sendBenchmarkMilestone?.(name)
}

// Record timing for imports (time from script start to here)
const importEndTime = performance.now()
sendTiming('renderer:imports', 0, importEndTime - rendererStartTime)

// Reuse existing root on HMR to avoid "createRoot() on a container that has
// already been passed to createRoot()" warning.
const container = document.getElementById('root')!
const existingRoot = (container as any).__reactRoot

const createRootStart = performance.now()
const root = existingRoot ?? ReactDOM.createRoot(container)
if (!existingRoot) {
  ;(container as any).__reactRoot = root
}
sendTiming('renderer:createRoot', createRootStart - rendererStartTime, performance.now() - createRootStart)

// Time render
const renderStart = performance.now()
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
sendTiming('renderer:render', renderStart - rendererStartTime, performance.now() - renderStart)
sendMilestone('renderer-render-called')
