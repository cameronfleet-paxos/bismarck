export interface RalphLoopPreset {
  id: string
  label: string
  description: string
  prompt: string
  completionPhrase: string
  maxIterations: number
  model: 'opus' | 'sonnet'
}

export const RALPH_LOOP_PRESETS: RalphLoopPreset[] = [
  {
    id: 'complete-beads-branch',
    label: 'Complete Beads (Branch)',
    description: 'Complete beads tasks, merging work into a single branch',
    prompt: `Complete all open beads tasks. All work is committed to the current branch.

## WORKFLOW

For each task:

1. **Discover**: Run \`bd --sandbox list --status=open\` to find the next task
2. **Claim**: Run \`bd --sandbox update <id> --status=in_progress\`
3. **Plan**: Use an Explore subagent (Task tool, subagent_type=Explore) to investigate the relevant codebase areas BEFORE writing any code
4. **Implement**: Write the code, commit with a descriptive message, and push
5. **Close**: Run \`bd --sandbox close <id>\`

## SINGLE TASK PER ITERATION

Complete ONE task, then stop without outputting the completion phrase. The next iteration will pick up remaining work. This prevents context exhaustion.

Exception: after closing a task, if \`bd --sandbox list --status=open\` returns ZERO open tasks, create a PR for the current branch and then output the completion phrase.

## COMPLETION
When all tasks are done (\`bd --sandbox list --status=open\` returns 0):
1. Ensure all changes are committed and pushed
2. Create a PR: \`gh pr create --base main --fill\`
3. Output the completion phrase

## RULES
- If a task is too complex, break it into subtasks using \`bd --sandbox create\`
- If a task fails, document why in task notes and create a follow-up task
- Always commit and push before closing a task`,
    completionPhrase: '<promise>COMPLETE</promise>',
    maxIterations: 50,
    model: 'opus'
  },
  {
    id: 'complete-beads-prs',
    label: 'Complete Beads (PRs)',
    description: 'Complete beads tasks, creating a separate PR for each',
    prompt: `Complete all open beads tasks. Each task gets its own branch and PR.

**NOTE**: This prompt overrides the wrapper's default git workflow. Follow the git instructions below instead.

## WORKFLOW

For each task:

1. **Discover**: Run \`bd --sandbox list --status=open\` to find the next task
2. **Claim**: Run \`bd --sandbox update <id> --status=in_progress\`
3. **Branch**: Create a task branch off origin/main:
   \`\`\`
   git fetch origin
   git checkout -b beads/<task-id> origin/main
   \`\`\`
4. **Plan**: Use an Explore subagent (Task tool, subagent_type=Explore) to investigate the relevant codebase areas BEFORE writing any code
5. **Implement**: Write the code and commit with a descriptive message
6. **PR**: Push and create a PR:
   \`\`\`
   git push -u origin beads/<task-id>
   gh pr create --base main --fill
   \`\`\`
7. **Close**: Run \`bd --sandbox close <id>\`
8. **Return**: Check out back to the loop branch (shown as "Branch:" in the header above):
   \`\`\`
   git checkout <loop-branch>
   \`\`\`

## SINGLE TASK PER ITERATION

Complete ONE task, then stop without outputting the completion phrase. The next iteration will pick up remaining work. This prevents context exhaustion.

Exception: after closing a task, if \`bd --sandbox list --status=open\` returns ZERO open tasks, then output the completion phrase.

## RULES
- If a task is too complex, break it into subtasks using \`bd --sandbox create\`
- If a task fails, document why in task notes and create a follow-up task
- Always push the task branch and create the PR before closing a task`,
    completionPhrase: '<promise>COMPLETE</promise>',
    maxIterations: 50,
    model: 'opus'
  },
  {
    id: 'custom',
    label: 'Custom Prompt',
    description: 'Write your own prompt',
    prompt: '',
    completionPhrase: '<promise>COMPLETE</promise>',
    maxIterations: 50,
    model: 'sonnet'
  }
]
