/**
 * Follow-up prompt presets for the FollowUpModal
 *
 * All presets are stored in settings and fully user-manageable (edit/delete).
 * DEFAULT_FOLLOWUP_PRESETS are seeded into settings on first load.
 */

export interface FollowUpPreset {
  id: string
  label: string
  description: string
  prompt: string
  requiresPrUrls?: boolean    // Only show when PR URLs exist
  suggestedModel?: 'opus' | 'sonnet'
}

/**
 * Default presets seeded into settings on first load.
 * Users can edit or delete these — they're regular presets.
 */
export const DEFAULT_FOLLOWUP_PRESETS: FollowUpPreset[] = [
  {
    id: 'resolve-pr-comments',
    label: 'Resolve PR Comments',
    description: 'Read and address all review comments on the PR',
    requiresPrUrls: true,
    suggestedModel: 'sonnet',
    prompt: `Read all review comments on the pull request using:
  gh pr view --comments
  gh api repos/{owner}/{repo}/pulls/{number}/comments

For each review comment:
1. Understand what the reviewer is asking for
2. Make the requested code changes
3. Reply to the comment explaining what you changed using:
   gh api repos/{owner}/{repo}/pulls/{number}/comments/{id}/replies -f body="..."

After addressing all comments:
1. Commit and push your changes
2. Post a summary comment on the PR listing all changes made:
   gh pr comment --body "Addressed review feedback: ..."`,
  },
]
