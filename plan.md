**Goal**: Create CodeEditorToolbar component with branch selector, ref controls, and commit log for worktree-based code review

**Files to modify**:
- `src/renderer/components/CodeEditorToolbar.tsx` - NEW: Create toolbar component with branch dropdown, checkout controls, and commit history display
- `src/renderer/components/DiffOverlay.tsx` - Add CodeEditorToolbar to the header section, pass directory and git state
- `src/main/git-utils.ts` - Add helper functions: getCurrentBranch, getLocalBranches, checkoutBranch, getCommitLog
- `src/main/main.ts` - Add IPC handlers for the new git operations (getCurrentBranch, getLocalBranches, checkoutBranch, getCommitLog)
- `src/main/preload.ts` - Expose new electronAPI methods for git operations
- `src/renderer/electron.d.ts` - Add TypeScript definitions for the new electronAPI methods

**Implementation steps**:

1. **Add git utility functions** (`src/main/git-utils.ts`):
   - Add `getCurrentBranch(directory: string): Promise<string>` - uses `git rev-parse --abbrev-ref HEAD`
   - Add `getLocalBranches(directory: string): Promise<string[]>` - uses `git branch --format='%(refname:short)'`
   - Add `checkoutBranch(directory: string, branch: string): Promise<void>` - uses `git checkout <branch>`
   - Add `getCommitLog(directory: string, limit: number = 10): Promise<CommitLogEntry[]>` - uses `git log --format='%H|%h|%s|%an|%ae|%at' -n <limit>`

2. **Define CommitLogEntry type** (`src/shared/types.ts`):
   - Add interface with fields: sha, shortSha, message, author, authorEmail, timestamp

3. **Create IPC handlers** (`src/main/main.ts`):
   - Add `ipcMain.handle('get-current-branch', ...)` - calls getCurrentBranch
   - Add `ipcMain.handle('get-local-branches', ...)` - calls getLocalBranches
   - Add `ipcMain.handle('checkout-branch', ...)` - calls checkoutBranch, refreshes diff cache
   - Add `ipcMain.handle('get-commit-log', ...)` - calls getCommitLog

4. **Expose IPC methods in preload** (`src/main/preload.ts`):
   - Add `getCurrentBranch: (directory: string) => Promise<string>`
   - Add `getLocalBranches: (directory: string) => Promise<string[]>`
   - Add `checkoutBranch: (directory: string, branch: string) => Promise<void>`
   - Add `getCommitLog: (directory: string, limit?: number) => Promise<CommitLogEntry[]>`

5. **Add TypeScript definitions** (`src/renderer/electron.d.ts`):
   - Add method signatures to ElectronAPI interface for all four new methods
   - Import CommitLogEntry type

6. **Create CodeEditorToolbar component** (`src/renderer/components/CodeEditorToolbar.tsx`):
   - Import Select, Button, Tooltip from ui components
   - Import GitBranch, GitCommit icons from lucide-react
   - Props: `{ directory: string; onRefChange?: () => void }`
   - State: currentBranch, branches, commits, isLoading, error
   - useEffect: Load current branch, branches list, and commit log on mount
   - Branch selector: Select dropdown with current branch, onChange calls checkoutBranch
   - Commit log: Collapsible section showing recent commits (shortSha + message)
   - Loading/error states with proper UI feedback
   - After checkout, trigger onRefChange callback to refresh diff view

7. **Integrate toolbar into DiffOverlay** (`src/renderer/components/DiffOverlay.tsx`):
   - Import CodeEditorToolbar
   - Add toolbar between header and content sections
   - Pass `directory` prop and `onRefChange` callback that calls handleRefresh()
   - Add border-b to separate from diff content
   - Ensure toolbar doesn't interfere with keyboard shortcuts

**Testing**:
1. Open DiffOverlay for a worktree with multiple branches
2. Verify branch selector shows current branch and all local branches
3. Switch to a different branch via dropdown - diff should refresh automatically
4. Verify commit log displays recent commits with short SHA and message
5. Test with repository that has no commits (should show empty state)
6. Test with non-git directory (toolbar should be hidden or show "Not a git repo")
7. Verify keyboard shortcuts (Escape, r, arrows) still work with toolbar present

**Risks**:
- Git operations could fail if directory is in detached HEAD state - handle gracefully
- Branch checkout might fail due to uncommitted changes - display clear error message
- Commit log parsing could break with unusual commit messages (pipes, newlines) - use null-separated format if needed
- Toolbar could make header too tall on small screens - consider collapsible commit log
- Multiple concurrent branch switches could race - debounce or disable during checkout
- Need to invalidate diff cache after branch switch to show correct changes
