---
allowed-tools:
  - Bash(gh pr *)
  - Bash(git *)
  - Bash(npm run dev:cdp*)
  - Bash(npm run build*)
  - Bash(curl *)
  - Bash(pkill *)
  - Bash(lsof *)
description: Iterate through open PRs, verify each via CDP, and merge with confirmation
---

# Merge PRs

Reviews and merges open PRs one by one. For each PR, checks out the branch, starts the dev server, takes a screenshot for visual verification, and asks for confirmation before merging.

When the user invokes `/bismarck:merge-prs`, follow these steps:

## 1. List open PRs

```bash
gh pr list --repo cameronfleet-paxos/bismarck --state open
```

If there are no open PRs, inform the user and stop.

## 2. Ensure on main and up to date

```bash
git checkout main
git pull
```

## 3. Process each PR sequentially

For each open PR, do the following:

### a. Check out the PR branch

```bash
gh pr checkout <number>
```

### b. Merge latest main into the branch

```bash
git merge main
```

If there are merge conflicts:
- Attempt to resolve them automatically
- If auto-resolution fails, show the conflicts to the user and ask what to do
- If the user wants to skip, move to the next PR

### c. Push the updated branch

```bash
git push
```

### d. Build and start the dev server

```bash
npm run build
npm run dev:cdp:wait
```

Note: `npm run dev:cdp:wait` requires sandbox bypass since Electron needs macOS bootstrap permissions.

### e. Wait for CDP health

```bash
curl -s localhost:9333/health
```

Retry a few times if not immediately healthy.

### f. Bypass onboarding if needed

```bash
curl -s -X POST localhost:9333/setup-test-env
```

### g. Take a screenshot and get app state

```bash
curl -s "localhost:9333/screenshot?path=/tmp/claude/pr-<number>.png"
curl -s localhost:9333/state
```

Read the screenshot file at `/tmp/claude/pr-<number>.png` so the user can see it.

### h. Ask the user for confirmation

Use AskUserQuestion to show:
- PR number and title
- PR description (from `gh pr view <number>`)
- The screenshot of the running app
- App state from CDP

Ask whether to **Merge**, **Skip**, or **Stop reviewing**.

### i. If confirmed: merge the PR

```bash
gh pr merge <number> --squash --delete-branch
```

### j. Stop the dev server

```bash
pkill -f "electron|cdp-server|vite" 2>/dev/null
```

Wait a moment for processes to terminate.

### k. Return to main

```bash
git checkout main
git pull
```

Then continue to the next PR.

## 4. Error handling

- **Dev server fails to start**: Skip CDP verification. Show the error to the user and ask if they want to merge the PR anyway based on the code diff (`gh pr diff <number>`).
- **Merge conflicts can't be auto-resolved**: Show the conflicting files and ask the user what to do.
- **User chooses "Stop reviewing"**: End the loop immediately and go to the summary.

## 5. Summary

After processing all PRs (or stopping early), report:
- Which PRs were merged
- Which PRs were skipped
- Any errors encountered

Make sure you're back on the `main` branch and the dev server is stopped before finishing.

## Important Notes

- Always stop the dev server between PRs to avoid port conflicts
- Always return to `main` before checking out the next PR
- Use `--squash` merge strategy to keep history clean
- The `--delete-branch` flag cleans up remote branches after merge
