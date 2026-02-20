import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function detectPnpmStorePath(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('pnpm', ['store', 'path'], { timeout: 5000 })
    const storePath = stdout.trim()
    return storePath || null
  } catch {
    return null
  }
}
