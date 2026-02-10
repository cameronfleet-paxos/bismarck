/**
 * Git repository browsing operations for code editor
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { findBinary } from './exec-utils';
import { isGitRepo } from './git-utils';
import type { DiffResult, DiffFile, FileDiffContent, GitFileEntry, GitCommit, GitBranch, FileContent } from '../shared/types';

const execFileAsync = promisify(execFile);

// Safety limits
const MAX_FILE_SIZE_BYTES = 100 * 1024; // 100KB
const DEFAULT_COMMIT_LIMIT = 100;

/**
 * Get the git binary path
 * Throws if git is not found
 */
function getGitPath(): string {
  const gitPath = findBinary('git');
  if (!gitPath) {
    throw new Error('Git binary not found. Please ensure git is installed.');
  }
  return gitPath;
}

/**
 * Detect language from file extension
 * Returns the filepath itself so CodeMirror's LanguageDescription.matchFilename()
 * can do proper language detection from the file extension
 */
function detectLanguage(filepath: string): string {
  return filepath;
}

/**
 * Check if a ref exists in the repository
 */
async function refExists(directory: string, ref: string): Promise<boolean> {
  const gitPath = getGitPath();
  try {
    await execFileAsync(gitPath, ['rev-parse', '--verify', ref], { cwd: directory });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all files in the repository at a given ref
 * Uses git ls-tree to get file paths
 *
 * @param directory - Repository working directory
 * @param ref - Git ref (default: HEAD)
 * @returns Array of file paths
 */
export async function listFiles(directory: string, ref: string = 'HEAD'): Promise<GitFileEntry[]> {
  const startTime = Date.now();
  logger.debug('git-browser', 'Listing files', { directory });

  // Return empty result for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-browser', 'Not a git repository, returning empty result', { directory });
    return [];
  }

  try {
    const gitPath = getGitPath();

    // Verify ref exists
    if (!await refExists(directory, ref)) {
      throw new Error(`Reference '${ref}' not found in repository`);
    }

    // Get file tree using ls-tree (recursive)
    const { stdout } = await execFileAsync(
      gitPath,
      ['ls-tree', '-r', '--full-tree', ref],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    const files: GitFileEntry[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;

      // Format: <mode> <type> <object> <file>
      // Example: 100644 blob 5e1c309dae7f45e0f39b1bf3ac3cd9db12e7d689    src/main.ts
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;

      const type = parts[1] as 'blob' | 'tree';
      const filepath = parts.slice(3).join(' '); // Handle filenames with spaces

      files.push({
        path: filepath,
        type,
      });
    }

    const duration = Date.now() - startTime;
    logger.debug(
      'git-browser',
      `Listed ${files.length} files (${duration}ms)`,
      { directory }
    );

    return files;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('git-browser', `Failed to list files (${duration}ms)`, { directory }, { error: err.message });
    throw new Error(`Failed to list files: ${err.message}`);
  }
}

/**
 * Get file content at a specific ref
 * Uses git show to read file content
 *
 * @param directory - Repository working directory
 * @param filepath - Relative path to file from repository root
 * @param ref - Git ref (default: HEAD)
 * @returns FileContent with content, language detection, and metadata
 */
export async function getFileContent(directory: string, filepath: string, ref: string = 'HEAD'): Promise<FileContent> {
  const startTime = Date.now();
  logger.debug('git-browser', 'Getting file content', { directory, filepath });

  // Return error for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-browser', 'Not a git repository', { directory });
    return {
      content: '',
      language: detectLanguage(filepath),
      isBinary: false,
      isTooLarge: false,
      error: 'Not a git repository',
    };
  }

  try {
    const gitPath = getGitPath();

    // Verify ref exists
    if (!await refExists(directory, ref)) {
      throw new Error(`Reference '${ref}' not found in repository`);
    }

    const language = detectLanguage(filepath);

    // First, check the size of the file
    try {
      const { stdout: sizeStr } = await execFileAsync(
        gitPath,
        ['cat-file', '-s', `${ref}:${filepath}`],
        { cwd: directory }
      );
      const size = parseInt(sizeStr.trim(), 10);

      if (size > MAX_FILE_SIZE_BYTES) {
        logger.warn('git-browser', 'File is too large to display', { directory, filepath, size });
        return {
          content: '',
          language,
          isBinary: false,
          isTooLarge: true,
        };
      }
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('does not exist') || err.message.includes('Not a valid object')) {
        return {
          content: '',
          language,
          isBinary: false,
          isTooLarge: false,
          error: 'File not found at this ref',
        };
      }
      throw error;
    }

    // Get file content as buffer to check for binary
    const { stdout: buffer } = await execFileAsync(
      gitPath,
      ['show', `${ref}:${filepath}`],
      { cwd: directory, encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }
    );

    // Check if binary by looking for null bytes in first 8KB
    const sampleSize = Math.min(buffer.length, 8192);
    const isBinary = buffer.slice(0, sampleSize).includes(0);

    if (isBinary) {
      logger.debug('git-browser', 'File is binary', { directory, filepath });
      return {
        content: '',
        language,
        isBinary: true,
        isTooLarge: false,
      };
    }

    const content = buffer.toString('utf8');
    const duration = Date.now() - startTime;
    logger.debug(
      'git-browser',
      `Retrieved file content (${duration}ms)`,
      { directory, filepath },
      { size: content.length }
    );

    return {
      content,
      language,
      isBinary: false,
      isTooLarge: false,
    };
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('git-browser', `Failed to get file content (${duration}ms)`, { directory, filepath }, { error: err.message });
    throw new Error(`Failed to get file content: ${err.message}`);
  }
}

/**
 * Get commit history for the repository
 * Uses git log with custom format
 *
 * @param directory - Repository working directory
 * @param options - Query options (limit, branch)
 * @returns Array of commit information
 */
export async function getCommitLog(
  directory: string,
  options?: { limit?: number; branch?: string }
): Promise<GitCommit[]> {
  const startTime = Date.now();
  const limit = options?.limit || DEFAULT_COMMIT_LIMIT;
  const branch = options?.branch || 'HEAD';

  logger.debug('git-browser', 'Getting commit log', { directory });

  // Return empty result for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-browser', 'Not a git repository, returning empty result', { directory });
    return [];
  }

  try {
    const gitPath = getGitPath();

    // Verify ref exists
    if (!await refExists(directory, branch)) {
      throw new Error(`Reference '${branch}' not found in repository`);
    }

    // Format: sha|shortSha|message|author|timestamp
    const { stdout } = await execFileAsync(
      gitPath,
      [
        'log',
        `--format=%H|%h|%s|%an|%aI`,
        `-n${limit}`,
        branch,
      ],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    const commits: GitCommit[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;

      const parts = line.split('|');
      if (parts.length < 5) continue;

      commits.push({
        sha: parts[0],
        shortSha: parts[1],
        message: parts[2],
        author: parts[3],
        timestamp: parts[4],
      });
    }

    const duration = Date.now() - startTime;
    logger.debug(
      'git-browser',
      `Retrieved ${commits.length} commits (${duration}ms)`,
      { directory }
    );

    return commits;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('git-browser', `Failed to get commit log (${duration}ms)`, { directory }, { error: err.message });
    throw new Error(`Failed to get commit log: ${err.message}`);
  }
}

/**
 * List all branches in the repository
 * Uses git branch to list local and remote branches
 *
 * @param directory - Repository working directory
 * @returns Array of branch information
 */
export async function getBranches(directory: string): Promise<GitBranch[]> {
  const startTime = Date.now();
  logger.debug('git-browser', 'Getting branches', { directory });

  // Return empty result for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-browser', 'Not a git repository, returning empty result', { directory });
    return [];
  }

  try {
    const gitPath = getGitPath();

    // Get all branches (local and remote) with format
    const { stdout } = await execFileAsync(
      gitPath,
      ['branch', '-a', '--format=%(refname:short)|%(objectname:short)|%(committerdate:iso8601)|%(HEAD)'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    const branches: GitBranch[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;

      const parts = line.split('|');
      if (parts.length < 4) continue;

      const name = parts[0];
      const shortSha = parts[1];
      const date = parts[2];
      const isCurrent = parts[3] === '*';

      // Skip remote HEAD pointers (e.g., origin/HEAD -> origin/main)
      if (name.includes('->')) continue;

      const isRemote = name.startsWith('remotes/');

      branches.push({
        name: isRemote ? name.replace('remotes/', '') : name,
        shortSha,
        date,
        isRemote,
        isCurrent,
      });
    }

    const duration = Date.now() - startTime;
    logger.debug(
      'git-browser',
      `Retrieved ${branches.length} branches (${duration}ms)`,
      { directory }
    );

    return branches;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('git-browser', `Failed to get branches (${duration}ms)`, { directory }, { error: err.message });
    throw new Error(`Failed to get branches: ${err.message}`);
  }
}

/**
 * Get diff between two refs
 * Uses git diff to show changes between refs
 *
 * @param directory - Repository working directory
 * @param fromRef - Starting ref
 * @param toRef - Ending ref
 * @returns DiffResult with changed files and summary
 */
export async function diffBetweenRefs(directory: string, fromRef: string, toRef: string): Promise<DiffResult> {
  const startTime = Date.now();
  logger.debug('git-browser', 'Getting diff between refs', { directory });

  // Return empty result for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-browser', 'Not a git repository, returning empty result', { directory });
    return {
      files: [],
      summary: { filesChanged: 0, additions: 0, deletions: 0 },
    };
  }

  try {
    const gitPath = getGitPath();

    // Verify refs exist
    if (!await refExists(directory, fromRef)) {
      throw new Error(`Reference '${fromRef}' not found in repository`);
    }
    if (!await refExists(directory, toRef)) {
      throw new Error(`Reference '${toRef}' not found in repository`);
    }

    // Get file status (modified, added, deleted, renamed)
    const { stdout: statusOutput } = await execFileAsync(
      gitPath,
      ['diff', '--name-status', `${fromRef}..${toRef}`],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Get numstat for line counts (additions/deletions)
    const { stdout: numstatOutput } = await execFileAsync(
      gitPath,
      ['diff', '--numstat', `${fromRef}..${toRef}`],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Parse status output (format: "M\tfile.txt" or "A\tfile.txt")
    const statusMap = new Map<string, 'modified' | 'added' | 'deleted' | 'renamed'>();
    for (const line of statusOutput.trim().split('\n')) {
      if (!line) continue;

      const [status, ...pathParts] = line.split('\t');
      const filepath = pathParts.join('\t'); // Handle filenames with tabs

      if (status.startsWith('M')) {
        statusMap.set(filepath, 'modified');
      } else if (status.startsWith('A')) {
        statusMap.set(filepath, 'added');
      } else if (status.startsWith('D')) {
        statusMap.set(filepath, 'deleted');
      } else if (status.startsWith('R')) {
        statusMap.set(filepath, 'renamed');
      }
    }

    // Parse numstat output (format: "additions\tdeletions\tfile.txt" or "-\t-\tfile.txt" for binary)
    const files: DiffFile[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const line of numstatOutput.trim().split('\n')) {
      if (!line) continue;

      const [addStr, delStr, ...pathParts] = line.split('\t');
      const filepath = pathParts.join('\t'); // Handle filenames with tabs

      // Binary files show '-' for both additions and deletions
      const isBinary = addStr === '-' && delStr === '-';
      const additions = isBinary ? 0 : parseInt(addStr, 10) || 0;
      const deletions = isBinary ? 0 : parseInt(delStr, 10) || 0;

      const status = statusMap.get(filepath) || 'modified';

      files.push({
        path: filepath,
        status,
        additions,
        deletions,
        isBinary,
      });

      totalAdditions += additions;
      totalDeletions += deletions;
    }

    const duration = Date.now() - startTime;
    logger.debug(
      'git-browser',
      `Found ${files.length} changed files (${duration}ms)`,
      { directory },
      { totalAdditions, totalDeletions }
    );

    return {
      files,
      summary: {
        filesChanged: files.length,
        additions: totalAdditions,
        deletions: totalDeletions,
      },
    };
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('git-browser', `Failed to get diff between refs (${duration}ms)`, { directory }, { error: err.message });
    throw new Error(`Failed to get diff between refs: ${err.message}`);
  }
}

/**
 * Get file content at two different refs for side-by-side comparison
 * Uses getFileContent internally
 *
 * @param directory - Repository working directory
 * @param filepath - Relative path to file from repository root
 * @param fromRef - Starting ref
 * @param toRef - Ending ref
 * @returns FileDiffContent with content from both refs
 */
export async function getFileDiffBetweenRefs(
  directory: string,
  filepath: string,
  fromRef: string,
  toRef: string
): Promise<FileDiffContent> {
  const startTime = Date.now();
  logger.debug('git-browser', 'Getting file diff between refs', { directory, filepath });

  // Return error for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-browser', 'Not a git repository', { directory });
    return {
      oldContent: '',
      newContent: '',
      language: detectLanguage(filepath),
      isBinary: false,
      isTooLarge: false,
      error: 'Not a git repository',
    };
  }

  try {
    const language = detectLanguage(filepath);

    // Get content from both refs
    const [oldResult, newResult] = await Promise.all([
      getFileContent(directory, filepath, fromRef),
      getFileContent(directory, filepath, toRef),
    ]);

    // Check for errors
    if (oldResult.error && newResult.error) {
      return {
        oldContent: '',
        newContent: '',
        language,
        isBinary: false,
        isTooLarge: false,
        error: `File not found in both refs: ${oldResult.error}`,
      };
    }

    // Check if binary
    if (oldResult.isBinary || newResult.isBinary) {
      return {
        oldContent: '',
        newContent: '',
        language,
        isBinary: true,
        isTooLarge: false,
      };
    }

    // Check if too large
    if (oldResult.isTooLarge || newResult.isTooLarge) {
      return {
        oldContent: '',
        newContent: '',
        language,
        isBinary: false,
        isTooLarge: true,
      };
    }

    const duration = Date.now() - startTime;
    logger.debug(
      'git-browser',
      `Retrieved file diff between refs (${duration}ms)`,
      { directory, filepath },
      { oldSize: oldResult.content.length, newSize: newResult.content.length }
    );

    return {
      oldContent: oldResult.content,
      newContent: newResult.content,
      language,
      isBinary: false,
      isTooLarge: false,
      error: oldResult.error || newResult.error,
    };
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('git-browser', `Failed to get file diff between refs (${duration}ms)`, { directory, filepath }, { error: err.message });
    throw new Error(`Failed to get file diff between refs: ${err.message}`);
  }
}
