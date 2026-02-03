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
    id: 'complete-beads',
    label: 'Complete All Beads Tasks',
    description: 'Work through all open beads tasks sequentially',
    prompt: `Complete all open beads tasks.

## WORKFLOW
1. Run \`bd --sandbox list --status=open\` to see all open tasks
2. For each task in order:
   - Run \`bd --sandbox update <id> --status=in_progress\` to claim it
   - Implement the task fully
   - Commit changes with descriptive message
   - Run \`bd --sandbox close <id>\` to mark complete
3. After each task, run \`bd --sandbox list --status=open\` to check remaining

## COMPLETION RULES - READ CAREFULLY
- Do NOT output the completion phrase until ALL tasks are closed
- Before outputting completion, you MUST verify: \`bd --sandbox list --status=open\` returns ZERO tasks
- If a task is too complex, break it into subtasks using \`bd --sandbox create\`, do NOT skip it
- If a task fails, document why in task notes and create follow-up tasks, but attempt ALL tasks
- Partial completion is NOT acceptable - all tasks must be attempted and closed

## EARLY STOP CONDITION
If you have completed substantial work (3+ tasks) and assess the NEXT task as large scope or complex:
- Do NOT output the completion phrase
- Simply stop without any special marker
- The next iteration will pick up where you left off
- This prevents context exhaustion on complex tasks

## VALIDATION BEFORE COMPLETION
Run these commands and verify output before completing:
\`\`\`
bd --sandbox list --status=open  # Must show 0 tasks
bd --sandbox stats               # Review completed count
git status                       # Ensure all changes committed
git push                         # Ensure pushed to remote
\`\`\`

Only after ALL validations pass, output the completion phrase.`,
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
