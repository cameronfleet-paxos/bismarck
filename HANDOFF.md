# Handoff: Fix Git Summary Not Updating
*Generated: 2026-02-01T09:35:00Z*

## Goal
Fix a bug where the Git Summary panel in the plan detail view shows "No git activity yet" even though commits are being made in task worktrees. The root cause is a fire-and-forget async call that allows worktree cleanup to happen before commits are recorded to gitSummary.

## Current State
- **Status**: in-progress (fix implemented, needs verification)
- **Branch**: main (uncommitted changes)
- **Key files modified**:
  - `src/main/plan-manager.ts` - Made `markWorktreeReadyForReview` async, await `handleTaskCompletionStrategy`, added debug logging

## Progress
- [x] Identified root cause: `handleTaskCompletionStrategy` was fire-and-forget (`.catch()` pattern)
- [x] Changed `markWorktreeReadyForReview` from `void` to `async Promise<void>`
- [x] Changed fire-and-forget to `try { await handleTaskCompletionStrategy(...) } catch`
- [x] Updated caller at line ~1500 (interactive terminal handler) - made callback async
- [x] Updated caller at line ~2014 (headless agent complete handler) - made callback async
- [x] Added debug logging: `logger.info('agent', 'Headless agent complete event received', ...)` at start of complete handler
- [x] Build passes

## What Worked
- The fix approach is sound: awaiting the git operation before allowing cleanup ensures commits are recorded

## What Didn't Work (CRITICAL)

### 1. Testing on already-running plan
**Problem**: After implementing the fix and rebuilding, we tested on a plan that was already in progress
**Why it failed**: The tasks (k00.3, k00.4) that completed did so BEFORE the dev server was restarted with the new code
**Evidence**: Container exits for k00.3 and k00.4 happened at `09:28:27` and `09:28:52`, but gitSummary was still empty
**Lesson**: Must restart the dev server AND start a fresh plan to test the fix

### 2. Missing debug logging made it hard to verify
**Problem**: We couldn't tell if the `agent.on('complete')` event handler was being called
**Why**: The original code had no logging at the start of the event handler
**Fix**: Added `logger.info('agent', 'Headless agent complete event received', ...)` at the start of the handler
**What to look for**: In debug.log, search for `Headless agent complete event received` - if this doesn't appear when a container exits with code 0, the event isn't firing

### 3. The debug log showed `result` events but no `complete` handling
**Observation**: We saw entries like:
```
[2026-02-01T09:28:26.325Z] [DEBUG] [agent] stdout received ... "type":"result","subtype":"success"
[2026-02-01T09:28:27.007Z] [INFO] [agent] Container exited with code 0
```
But never saw `completed (headless)` activity entry or `ready for review` - meaning `agent.on('complete')` wasn't triggering

## Key Decisions Made
- Await `handleTaskCompletionStrategy` instead of fire-and-forget to ensure commits are recorded before cleanup
- Add debug logging to verify the event handler is called

## Next Steps
1. **Start fresh plan** - The dev server was just restarted with the fix. Start a NEW plan execution (not continue an existing one)
2. **Monitor debug log** for these entries when a task completes:
   ```
   Headless agent complete event received
   Task X completed (headless)
   Task X ready for review
   Pushed X commit(s) for task Y
   ```
3. **Check gitSummary** after task completion:
   ```bash
   cat ~/.bismark/plans.json | jq '.[] | select(.status == "in_progress") | .gitSummary'
   ```
4. **If still not working**, investigate why `agent.on('complete')` isn't firing - check HeadlessAgent.emit('complete') in headless-agent.ts

## Verification
1. Start dev server: `npm run dev:cdp:clean` (already running)
2. Start a NEW plan with `feature_branch` strategy (don't resume existing)
3. Wait for at least one task to complete naturally (container exits with code 0)
4. Check debug.log for `Headless agent complete event received`:
   ```bash
   grep "complete event received" ~/.bismark/plans/<planId>/debug.log
   ```
5. Check gitSummary is populated:
   ```bash
   cat ~/.bismark/plans.json | jq '.[] | select(.status == "in_progress") | .gitSummary'
   ```
   Expected: `{ "commits": [ { "sha": "...", "message": "...", ... } ] }`

## Context Files
- `src/main/plan-manager.ts` - Lines 2003-2018: the `agent.on('complete')` handler with new logging
- `src/main/plan-manager.ts` - Lines 2298-2342: `markWorktreeReadyForReview` (now async)
- `src/main/plan-manager.ts` - Lines 2335-2341: the awaited `handleTaskCompletionStrategy` call
- `src/main/headless-agent.ts` - Lines 271-297: `handleContainerExit` which emits 'complete'
