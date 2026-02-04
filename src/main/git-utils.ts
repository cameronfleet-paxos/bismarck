/**
 * Git utility functions for repository detection and worktree management
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { logger, LogContext } from './logger';
import { execWithPath } from './exec-utils';

// Use shared exec utility with extended PATH for git commands
const exec = execWithPath;

/**
 * Execute a git command in the specified directory
 * @param command - The git command to execute
 * @param cwd - The working directory
 * @param logContext - Optional logging context for correlation
 */
async function gitExec(
  command: string,
  cwd: string,
  logContext?: LogContext
): Promise<{ stdout: string; stderr: string }> {
  const startTime = Date.now();
  try {
    const result = await exec(command, { cwd });
    const duration = Date.now() - startTime;
    logger.debug('git', `Executed (${duration}ms): ${command}`, { ...logContext, repo: cwd }, {
      stdout: result.stdout.substring(0, 200),
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error as Error & { stdout?: string; stderr?: string };
    logger.error('git', `Command failed (${duration}ms): ${command}`, { ...logContext, repo: cwd }, {
      stderr: err.stderr,
      message: err.message,
    });
    // Re-throw with more context
    throw new Error(
      `Git command failed: ${command}\n${err.stderr || err.message}`
    );
  }
}

/**
 * Check if a directory is inside a git repository
 */
export async function isGitRepo(directory: string): Promise<boolean> {
  try {
    await gitExec('git rev-parse --git-dir', directory);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root directory of a git repository
 * Returns null if the directory is not in a git repo
 */
export async function getRepoRoot(directory: string): Promise<string | null> {
  try {
    const { stdout } = await gitExec(
      'git rev-parse --show-toplevel',
      directory
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get the git common directory (the root .git directory, even from a worktree)
 * This is useful for finding the main repository when inside a worktree
 */
export async function getGitCommonDir(
  directory: string
): Promise<string | null> {
  try {
    const { stdout } = await gitExec(
      'git rev-parse --path-format=absolute --git-common-dir',
      directory
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a directory is a git worktree (not the main repo)
 */
export async function isWorktree(directory: string): Promise<boolean> {
  try {
    const gitDir = await gitExec('git rev-parse --git-dir', directory);
    const gitDirPath = gitDir.stdout.trim();

    // If the .git dir is a file (not a directory), it's a worktree
    // Worktrees have a .git file that points to the main repo
    if (!path.isAbsolute(gitDirPath)) {
      const fullPath = path.join(directory, gitDirPath);
      const stats = await fs.stat(fullPath);
      return stats.isFile();
    }

    // Also check if git-common-dir differs from git-dir
    const commonDir = await getGitCommonDir(directory);
    const repoRoot = await getRepoRoot(directory);

    if (commonDir && repoRoot) {
      // For worktrees, the common dir is inside the main repo's .git
      const expectedGitDir = path.join(repoRoot, '.git');
      return commonDir !== expectedGitDir;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get the main repository root, even when inside a worktree
 * This resolves to the actual repository that contains .git directory
 */
export async function getMainRepoRoot(
  directory: string
): Promise<string | null> {
  try {
    const commonDir = await getGitCommonDir(directory);
    if (!commonDir) return null;

    // The common dir is typically /path/to/repo/.git
    // We need the parent directory
    if (commonDir.endsWith('.git')) {
      return path.dirname(commonDir);
    }

    // Sometimes it might be a bare repo or different structure
    return commonDir;
  } catch {
    return null;
  }
}

/**
 * Get the default branch for a repository (usually main or master)
 */
export async function getDefaultBranch(directory: string): Promise<string> {
  try {
    // Try to get the default branch from the remote
    const { stdout } = await gitExec(
      'git symbolic-ref refs/remotes/origin/HEAD',
      directory
    );
    const ref = stdout.trim();
    // refs/remotes/origin/main -> main
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    // Fallback: check if main or master exists
    try {
      await gitExec('git rev-parse --verify main', directory);
      return 'main';
    } catch {
      try {
        await gitExec('git rev-parse --verify master', directory);
        return 'master';
      } catch {
        // Last resort: get current branch
        try {
          const { stdout } = await gitExec(
            'git branch --show-current',
            directory
          );
          return stdout.trim() || 'main';
        } catch {
          return 'main';
        }
      }
    }
  }
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(directory: string): Promise<string> {
  try {
    const { stdout } = await gitExec('git branch --show-current', directory);
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Get the remote URL for the repository (origin)
 */
export async function getRemoteUrl(directory: string): Promise<string | null> {
  try {
    const { stdout } = await gitExec(
      'git remote get-url origin',
      directory
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get the timestamp of the most recent commit in the repository
 * Returns ISO 8601 timestamp string or null if no commits/error
 */
export async function getLastCommitDate(directory: string): Promise<string | null> {
  try {
    const { stdout } = await gitExec(
      'git log -1 --format=%aI',  // %aI = author date, ISO 8601 format
      directory
    );
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/**
 * Create a new git worktree
 * @param logContext - Optional logging context for correlation
 */
export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  baseBranch: string,
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, worktreePath, branch: branchName };
  logger.info('worktree', `Creating worktree`, ctx, { baseBranch });
  logger.time(`worktree-create-${worktreePath}`);

  // Check if worktree path already exists and clean it up
  try {
    const stat = await fs.stat(worktreePath);
    if (stat.isDirectory()) {
      logger.warn('worktree', 'Worktree path already exists, removing it first', ctx);
      // First try git worktree remove in case it's a valid worktree
      try {
        await gitExec(`git worktree remove "${worktreePath}" --force`, repoPath, ctx);
      } catch {
        // Not a valid worktree, just remove the directory
        await fs.rm(worktreePath, { recursive: true, force: true });
      }
      // Prune stale refs
      await gitExec('git worktree prune', repoPath, ctx);
    }
  } catch {
    // Path doesn't exist, which is good
  }

  // Ensure the parent directory exists
  const parentDir = path.dirname(worktreePath);
  await fs.mkdir(parentDir, { recursive: true });

  // Fetch the specific base branch with explicit refspec to ensure we have the latest
  // This is critical when the base branch was recently pushed by another task agent
  // A general 'git fetch origin' may not update the ref if it was just pushed
  try {
    await gitExec(
      `git fetch origin "${baseBranch}:refs/remotes/origin/${baseBranch}" --force`,
      repoPath,
      ctx
    );
    logger.debug('worktree', 'Fetched base branch with explicit refspec', ctx, { baseBranch });
  } catch {
    // Fallback to general fetch if explicit fetch fails (branch may not exist on remote yet)
    logger.debug('worktree', 'Explicit fetch failed, trying general fetch', ctx, { baseBranch });
    try {
      await gitExec('git fetch origin', repoPath, ctx);
    } catch {
      logger.debug('worktree', 'Fetch failed (network may be unavailable)', ctx);
      // Ignore fetch errors (might not have network)
    }
  }

  // Create the worktree with a new branch based on the base branch
  // Use origin/<baseBranch> to ensure we're based on the latest remote
  try {
    await gitExec(
      `git worktree add -b "${branchName}" "${worktreePath}" "origin/${baseBranch}"`,
      repoPath,
      ctx
    );
    logger.timeEnd(`worktree-create-${worktreePath}`, 'worktree', 'Created worktree from origin', ctx);
  } catch {
    // Fallback to local branch if remote doesn't exist
    logger.debug('worktree', 'Falling back to local branch (remote not found)', ctx);
    await gitExec(
      `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
      repoPath,
      ctx
    );
    logger.timeEnd(`worktree-create-${worktreePath}`, 'worktree', 'Created worktree from local branch', ctx);
  }

  // Verify the worktree has content (more than just .git)
  // This catches cases where the base branch ref was stale
  const files = await fs.readdir(worktreePath);
  const nonGitFiles = files.filter(f => f !== '.git');
  if (nonGitFiles.length === 0) {
    logger.error('worktree', 'Worktree created but appears empty - base branch may be stale', ctx, {
      baseBranch,
      files,
    });
    throw new Error(`Worktree created but is empty. Base branch '${baseBranch}' may not have been fetched correctly.`);
  }
  logger.debug('worktree', 'Worktree verified with content', ctx, { fileCount: nonGitFiles.length });
}

/**
 * Remove a git worktree
 * @param logContext - Optional logging context for correlation
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false,
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, worktreePath };
  logger.info('worktree', `Removing worktree`, ctx, { force });

  const forceFlag = force ? ' --force' : '';
  try {
    await gitExec(
      `git worktree remove "${worktreePath}"${forceFlag}`,
      repoPath,
      ctx
    );
    logger.info('worktree', 'Removed worktree successfully', ctx);
  } catch (error) {
    // If the worktree directory doesn't exist, just prune
    const err = error as Error;
    if (err.message.includes('is not a working tree')) {
      logger.debug('worktree', 'Worktree not found, pruning stale refs', ctx);
      await pruneWorktrees(repoPath, ctx);
    } else {
      logger.error('worktree', 'Failed to remove worktree', ctx, { error: err.message });
      throw error;
    }
  }
}

/**
 * Prune stale worktree references
 * @param logContext - Optional logging context for correlation
 */
export async function pruneWorktrees(repoPath: string, logContext?: LogContext): Promise<void> {
  logger.debug('worktree', 'Pruning stale worktree references', { ...logContext, repo: repoPath });
  await gitExec('git worktree prune', repoPath, logContext);
}

/**
 * List all worktrees for a repository
 */
export async function listWorktrees(
  repoPath: string
): Promise<Array<{ path: string; branch: string; head: string }>> {
  try {
    const { stdout } = await gitExec(
      'git worktree list --porcelain',
      repoPath
    );

    const worktrees: Array<{ path: string; branch: string; head: string }> = [];
    let current: { path: string; branch: string; head: string } | null = null;

    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.substring(9), branch: '', head: '' };
      } else if (line.startsWith('HEAD ') && current) {
        current.head = line.substring(5);
      } else if (line.startsWith('branch ') && current) {
        // refs/heads/main -> main
        current.branch = line.substring(7).replace('refs/heads/', '');
      }
    }

    if (current) worktrees.push(current);
    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Check if a branch exists (locally or remotely)
 */
export async function branchExists(
  repoPath: string,
  branchName: string
): Promise<boolean> {
  try {
    await gitExec(`git rev-parse --verify "${branchName}"`, repoPath);
    return true;
  } catch {
    try {
      await gitExec(
        `git rev-parse --verify "origin/${branchName}"`,
        repoPath
      );
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Generate a unique branch name if the desired one already exists
 */
export async function generateUniqueBranchName(
  repoPath: string,
  baseName: string
): Promise<string> {
  let name = baseName;
  let counter = 1;

  while (await branchExists(repoPath, name)) {
    name = `${baseName}-${counter}`;
    counter++;
  }

  return name;
}

/**
 * Push a branch to remote
 * @param logContext - Optional logging context for correlation
 */
export async function pushBranch(
  repoPath: string,
  branchName: string,
  remote = 'origin',
  setUpstream = true,
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, branch: branchName };
  logger.info('git', `Pushing branch to ${remote}`, ctx, { setUpstream });

  const upstreamFlag = setUpstream ? '-u ' : '';
  await gitExec(
    `git push ${upstreamFlag}${remote} "${branchName}"`,
    repoPath,
    ctx
  );
  logger.info('git', 'Branch pushed successfully', ctx);
}

/**
 * Push a local ref to a different remote branch name
 * e.g., push HEAD to origin/feature-branch
 *
 * @param forceWithLease - Use --force-with-lease for safer force pushes (useful after rebasing)
 * @param logContext - Optional logging context for correlation
 */
export async function pushBranchToRemoteBranch(
  repoPath: string,
  localRef: string,
  remoteBranch: string,
  remote = 'origin',
  forceWithLease = false,
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, branch: remoteBranch };
  logger.info('git', `Pushing ${localRef} to ${remote}/${remoteBranch}`, ctx, { forceWithLease });

  // git push origin HEAD:refs/heads/feature-branch
  const forceFlag = forceWithLease ? '--force-with-lease ' : '';
  await gitExec(
    `git push ${forceFlag}${remote} "${localRef}:refs/heads/${remoteBranch}"`,
    repoPath,
    ctx
  );
  logger.info('git', 'Push to remote branch completed', ctx);
}

/**
 * Get commits between two refs (base..head)
 * Returns array of commit objects with sha, message, timestamp
 */
export async function getCommitsBetween(
  repoPath: string,
  baseRef: string,
  headRef: string
): Promise<Array<{ sha: string; shortSha: string; message: string; timestamp: string }>> {
  try {
    // Use %H for full sha, %h for short sha, %s for subject, %aI for ISO timestamp
    const { stdout } = await gitExec(
      `git log --format="%H|%h|%s|%aI" "${baseRef}..${headRef}"`,
      repoPath
    );

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [sha, shortSha, message, timestamp] = line.split('|');
        return { sha, shortSha, message, timestamp };
      });
  } catch {
    return [];
  }
}

/**
 * Fetch from remote and rebase current branch onto target branch
 * @param logContext - Optional logging context for correlation
 */
export async function fetchAndRebase(
  repoPath: string,
  targetBranch: string,
  remote = 'origin',
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath };
  logger.info('git', `Fetching and rebasing onto ${remote}/${targetBranch}`, ctx);
  logger.time(`rebase-${repoPath}`);

  // Fetch latest from remote
  await gitExec(`git fetch ${remote}`, repoPath, ctx);

  // Rebase onto the target branch
  await gitExec(`git rebase "${remote}/${targetBranch}"`, repoPath, ctx);

  logger.timeEnd(`rebase-${repoPath}`, 'git', 'Fetch and rebase completed', ctx);
}

/**
 * Push to remote branch with automatic retry on non-fast-forward errors.
 * On failure, fetches latest, rebases, and retries.
 */
export async function pushWithRetry(
  repoPath: string,
  localRef: string,
  remoteBranch: string,
  remote = 'origin',
  maxRetries = 3,
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, branch: remoteBranch };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // On retry attempts, fetch and rebase first
      if (attempt > 1) {
        logger.info('git', `Retry attempt ${attempt}/${maxRetries}: fetch and rebase`, ctx);
        try {
          await gitExec(`git fetch ${remote}`, repoPath, ctx);
          await gitExec(`git rebase "${remote}/${remoteBranch}"`, repoPath, ctx);
        } catch (rebaseError) {
          const err = rebaseError as Error;
          // Rebase conflict - abort and propagate error
          if (err.message.includes('CONFLICT') || err.message.includes('could not apply')) {
            logger.error('git', 'Rebase conflict detected, aborting', ctx);
            try {
              await gitExec('git rebase --abort', repoPath, ctx);
            } catch { /* ignore abort errors */ }
            throw new Error(`Rebase conflict while pushing to ${remoteBranch}. Manual resolution required.`);
          }
          // Other rebase errors - log and continue with push attempt
          logger.warn('git', 'Rebase failed, attempting push anyway', ctx, { error: err.message });
        }
      }

      // Attempt the push
      await pushBranchToRemoteBranch(repoPath, localRef, remoteBranch, remote, false, ctx);

      if (attempt > 1) {
        logger.info('git', `Push succeeded on attempt ${attempt}`, ctx);
      }
      return; // Success

    } catch (error) {
      const err = error as Error;
      const isNonFastForward = err.message.includes('non-fast-forward') ||
                               err.message.includes('rejected') ||
                               err.message.includes('failed to push');

      if (!isNonFastForward || attempt === maxRetries) {
        logger.error('git', `Push failed after ${attempt} attempt(s)`, ctx, { error: err.message });
        throw error;
      }

      logger.warn('git', `Push failed (non-fast-forward), will retry`, ctx, { attempt, maxRetries });
    }
  }
}

/**
 * Get the GitHub URL for a repository from its remote URL
 * Converts git@github.com:org/repo.git to https://github.com/org/repo
 */
export function getGitHubUrlFromRemote(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;

  // Handle SSH URLs: git@github.com:org/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }

  // Handle HTTPS URLs: https://github.com/org/repo.git
  const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }

  return null;
}

/**
 * Get the current HEAD commit SHA
 */
export async function getHeadCommit(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await gitExec('git rev-parse HEAD', repoPath);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Create and checkout a new branch from a base branch
 * @param logContext - Optional logging context for correlation
 */
export async function createBranch(
  repoPath: string,
  branchName: string,
  baseBranch: string,
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, branch: branchName };
  logger.info('git', `Creating branch from ${baseBranch}`, ctx);

  // Fetch latest first
  try {
    await gitExec('git fetch origin', repoPath, ctx);
  } catch {
    logger.debug('git', 'Fetch failed (network may be unavailable)', ctx);
    // Ignore fetch errors (might not have network)
  }

  // Create branch from origin/baseBranch if available, otherwise local
  try {
    await gitExec(
      `git checkout -b "${branchName}" "origin/${baseBranch}"`,
      repoPath,
      ctx
    );
    logger.info('git', 'Branch created from origin', ctx);
  } catch {
    logger.debug('git', 'Falling back to local base branch', ctx);
    await gitExec(
      `git checkout -b "${branchName}" "${baseBranch}"`,
      repoPath,
      ctx
    );
    logger.info('git', 'Branch created from local', ctx);
  }
}

/**
 * Checkout an existing branch
 */
export async function checkoutBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  await gitExec(`git checkout "${branchName}"`, repoPath);
}

/**
 * Pull latest changes for the current branch
 */
export async function pullBranch(
  repoPath: string,
  remote = 'origin'
): Promise<void> {
  await gitExec(`git pull ${remote}`, repoPath);
}

/**
 * Fetch a specific branch from remote
 * Ensures the local remote-tracking branch is up to date
 * @param logContext - Optional logging context for correlation
 */
export async function fetchBranch(
  repoPath: string,
  branchName: string,
  remote = 'origin',
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, branch: branchName };
  logger.debug('git', `Fetching branch from ${remote}`, ctx);
  await gitExec(`git fetch ${remote} "${branchName}"`, repoPath, ctx);
}

/**
 * Fetch a specific branch from remote with force flag
 * This ensures the local tracking ref is updated even if it's not a fast-forward
 * @param logContext - Optional logging context for correlation
 */
export async function fetchBranchWithForce(
  repoPath: string,
  branchName: string,
  remote = 'origin',
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, branch: branchName };
  logger.debug('git', `Force fetching branch from ${remote}`, ctx);
  await gitExec(
    `git fetch ${remote} "${branchName}:refs/remotes/${remote}/${branchName}" --force`,
    repoPath,
    ctx
  );
}

/**
 * Rebase the current branch onto a target remote branch
 * @returns true if rebase succeeded, false if there was a conflict (rebase aborted)
 * @throws Error on non-conflict rebase failures
 */
export async function rebaseOntoRemoteBranch(
  repoPath: string,
  targetBranch: string,
  remote = 'origin',
  logContext?: LogContext
): Promise<{ success: boolean; conflictError?: Error }> {
  const ctx = { ...logContext, repo: repoPath, branch: targetBranch };
  logger.info('git', `Rebasing onto ${remote}/${targetBranch}`, ctx);

  try {
    await gitExec(`git rebase "${remote}/${targetBranch}"`, repoPath, ctx);
    return { success: true };
  } catch (error) {
    const err = error as Error;
    // Check if this is a conflict
    const isConflict = err.message.includes('CONFLICT') ||
                       err.message.includes('could not apply') ||
                       err.message.includes('Resolve all conflicts') ||
                       err.message.includes('fix conflicts');

    if (isConflict) {
      logger.warn('git', 'Rebase conflict detected, aborting rebase', ctx);
      try {
        await gitExec('git rebase --abort', repoPath, ctx);
      } catch {
        // Ignore abort errors
      }
      return { success: false, conflictError: err };
    }

    // Non-conflict error - rethrow
    throw error;
  }
}

/**
 * Check if a remote branch exists
 */
export async function remoteBranchExists(
  repoPath: string,
  branchName: string,
  remote = 'origin'
): Promise<boolean> {
  try {
    await gitExec(`git ls-remote --exit-code --heads ${remote} "${branchName}"`, repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a remote branch
 * @param logContext - Optional logging context for correlation
 */
export async function deleteRemoteBranch(
  repoPath: string,
  branchName: string,
  remote: string = 'origin',
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, branch: branchName };
  logger.info('git', `Deleting remote branch from ${remote}`, ctx);
  await gitExec(`git push ${remote} --delete "${branchName}"`, repoPath, ctx);
  logger.info('git', 'Remote branch deleted', ctx);
}

/**
 * Delete a local branch (force delete)
 * @param logContext - Optional logging context for correlation
 */
export async function deleteLocalBranch(
  repoPath: string,
  branchName: string,
  logContext?: LogContext
): Promise<void> {
  const ctx = { ...logContext, repo: repoPath, branch: branchName };
  logger.debug('git', 'Deleting local branch', ctx);
  await gitExec(`git branch -D "${branchName}"`, repoPath, ctx);
}

/**
 * Git user configuration
 */
export interface GitUserConfig {
  userName: string | null;
  userEmail: string | null;
}

// Cached git user configuration
let gitUserConfigCache: GitUserConfig | null = null;

/**
 * Get the host's git user configuration
 * Returns user.name and user.email from global git config
 */
export async function getGitUserConfig(): Promise<GitUserConfig> {
  // Return cached config if available
  if (gitUserConfigCache) {
    return gitUserConfigCache;
  }

  const getConfigValue = async (key: string): Promise<string | null> => {
    try {
      const { stdout } = await exec(`git config --global --get ${key}`);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  };

  gitUserConfigCache = {
    userName: await getConfigValue('user.name'),
    userEmail: await getConfigValue('user.email'),
  };

  logger.debug('git', 'Loaded git user config', undefined, gitUserConfigCache);

  return gitUserConfigCache;
}
