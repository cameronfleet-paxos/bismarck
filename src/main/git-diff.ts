/**
 * Git diff operations for displaying file changes
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { findBinary } from './exec-utils';
import { isGitRepo } from './git-utils';
import type { DiffResult, DiffFile, FileDiffContent } from '../shared/types';

const execFileAsync = promisify(execFile);

// Safety limit to prevent overwhelming the UI
const MAX_FILES = 500;
const MAX_FILE_SIZE_BYTES = 100 * 1024; // 100KB

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
 * Check if a file has a HEAD commit (i.e., was it committed before)
 */
async function hasHeadCommit(directory: string): Promise<boolean> {
  const gitPath = getGitPath();
  try {
    await execFileAsync(gitPath, ['rev-parse', 'HEAD'], { cwd: directory });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get changed files in the working directory compared to HEAD
 * Returns list of files with their status and line change counts
 *
 * @param directory - Repository working directory
 * @returns DiffResult with files and summary statistics
 */
export async function getChangedFiles(directory: string): Promise<DiffResult> {
  const startTime = Date.now();
  logger.debug('git-diff', 'Getting changed files', { directory });

  // Return empty result for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-diff', 'Not a git repository, returning empty result', { directory });
    return {
      files: [],
      summary: { filesChanged: 0, additions: 0, deletions: 0 },
    };
  }

  try {
    const gitPath = getGitPath();
    const hasHead = await hasHeadCommit(directory);

    if (!hasHead) {
      // No HEAD commit - treat all tracked and untracked files as 'added'
      logger.debug('git-diff', 'No HEAD commit, treating all files as added', { directory });

      try {
        // Get list of all files in working directory (excluding .git)
        const { stdout: lsOutput } = await execFileAsync(
          gitPath,
          ['ls-files', '--others', '--cached', '--exclude-standard'],
          { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
        );

        const files: DiffFile[] = lsOutput
          .trim()
          .split('\n')
          .filter(line => line.length > 0)
          .slice(0, MAX_FILES)
          .map(filepath => ({
            path: filepath,
            status: 'added' as const,
            additions: 0,
            deletions: 0,
            isBinary: false,
          }));

        const duration = Date.now() - startTime;
        logger.debug('git-diff', `Found ${files.length} new files (${duration}ms)`, { directory });

        return {
          files,
          summary: {
            filesChanged: files.length,
            additions: 0,
            deletions: 0,
          },
        };
      } catch (error) {
        const err = error as Error;
        logger.error('git-diff', 'Failed to list files in new repository', { directory }, { error: err.message });
        throw new Error(`Failed to list files: ${err.message}`);
      }
    }

    // Get file status (modified, added, deleted, renamed) - staged + unstaged vs HEAD
    const { stdout: statusOutput } = await execFileAsync(
      gitPath,
      ['diff', 'HEAD', '--name-status'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Get numstat for line counts (additions/deletions)
    const { stdout: numstatOutput } = await execFileAsync(
      gitPath,
      ['diff', 'HEAD', '--numstat'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    const statusMap = parseNameStatus(statusOutput);
    const { files, totalAdditions, totalDeletions } = parseNumstat(numstatOutput, statusMap);

    // Also include untracked files (new files never git-added)
    const { stdout: untrackedOutput } = await execFileAsync(
      gitPath,
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    const trackedPaths = new Set(files.map(f => f.path));
    for (const line of untrackedOutput.trim().split('\n')) {
      if (!line || trackedPaths.has(line)) continue;
      if (files.length >= MAX_FILES) break;
      files.push({
        path: line,
        status: 'untracked',
        additions: 0,
        deletions: 0,
        isBinary: false,
      });
    }

    const duration = Date.now() - startTime;
    logger.debug(
      'git-diff',
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
    logger.error('git-diff', `Failed to get changed files (${duration}ms)`, { directory }, { error: err.message });
    throw new Error(`Failed to get changed files: ${err.message}`);
  }
}

/**
 * Get the diff content for a specific file
 * Returns old and new content for side-by-side comparison
 *
 * @param directory - Repository working directory
 * @param filepath - Relative path to file from repository root
 * @returns FileDiffContent with old/new content and metadata
 */
export async function getFileDiff(directory: string, filepath: string, force?: boolean): Promise<FileDiffContent> {
  const startTime = Date.now();
  logger.debug('git-diff', `Getting file diff${force ? ' (force)' : ''}`, { directory, filepath });

  // Return error for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-diff', 'Not a git repository', { directory });
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
    const gitPath = getGitPath();
    const hasHead = await hasHeadCommit(directory);
    const fullPath = path.join(directory, filepath);

    // Detect language
    const language = detectLanguage(filepath);

    // Check if file is too large (skip when force=true)
    try {
      const stats = await fs.stat(fullPath);
      if (!force && stats.size > MAX_FILE_SIZE_BYTES) {
        logger.warn('git-diff', 'File is too large to display', { directory, filepath, size: stats.size });
        return {
          oldContent: '',
          newContent: '',
          language,
          isBinary: false,
          isTooLarge: true,
        };
      }
    } catch {
      // File might be deleted, stat will fail - that's okay, continue
    }

    // Get old content (from HEAD)
    let oldContent = '';
    if (hasHead) {
      try {
        const { stdout } = await execFileAsync(
          gitPath,
          ['show', `HEAD:${filepath}`],
          { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
        );
        oldContent = stdout;
      } catch (error) {
        // File might be newly added (not in HEAD), or deleted
        const err = error as Error & { code?: string };
        if (err.message.includes('does not exist') || err.message.includes('exists on disk, but not in')) {
          // File is newly added
          oldContent = '';
        } else {
          // Some other error
          logger.error('git-diff', 'Failed to get old file content', { directory, filepath }, { error: err.message });
          return {
            oldContent: '',
            newContent: '',
            language,
            isBinary: false,
            isTooLarge: false,
            error: `Failed to read old version: ${err.message}`,
          };
        }
      }
    }

    // Get new content (working directory first, fall back to staged index)
    // This ensures we show staged-only changes even when the working tree matches HEAD
    let newContent = '';
    try {
      // Check if file exists in working directory
      await fs.access(fullPath);
      const buffer = await fs.readFile(fullPath);

      // Check if binary by looking for null bytes in first 8KB
      const sampleSize = Math.min(buffer.length, 8192);
      const isBinary = buffer.slice(0, sampleSize).includes(0);

      if (isBinary) {
        logger.debug('git-diff', 'File is binary', { directory, filepath });
        return {
          oldContent: '',
          newContent: '',
          language,
          isBinary: true,
          isTooLarge: false,
        };
      }

      newContent = buffer.toString('utf8');

      // If working tree content matches HEAD, check staged index for changes
      if (newContent === oldContent) {
        try {
          const { stdout: stagedContent } = await execFileAsync(
            gitPath,
            ['show', `:${filepath}`],
            { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
          );
          if (stagedContent !== oldContent) {
            newContent = stagedContent;
          }
        } catch {
          // No staged version, that's fine
        }
      }
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === 'ENOENT') {
        // File was deleted from working tree - check if staged version exists
        try {
          const { stdout: stagedContent } = await execFileAsync(
            gitPath,
            ['show', `:${filepath}`],
            { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
          );
          newContent = stagedContent;
        } catch {
          newContent = ''; // Truly deleted
        }
      } else if (err.code === 'EACCES') {
        // Permission error
        logger.error('git-diff', 'Permission denied reading file', { directory, filepath });
        return {
          oldContent: '',
          newContent: '',
          language,
          isBinary: false,
          isTooLarge: false,
          error: 'Permission denied',
        };
      } else {
        // Other error
        logger.error('git-diff', 'Failed to read new file content', { directory, filepath }, { error: err.message });
        return {
          oldContent: '',
          newContent: '',
          language,
          isBinary: false,
          isTooLarge: false,
          error: `Failed to read file: ${err.message}`,
        };
      }
    }

    const duration = Date.now() - startTime;
    logger.debug(
      'git-diff',
      `Retrieved file diff (${duration}ms)`,
      { directory, filepath },
      { oldSize: oldContent.length, newSize: newContent.length }
    );

    return {
      oldContent,
      newContent,
      language,
      isBinary: false,
      isTooLarge: false,
    };
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('git-diff', `Failed to get file diff (${duration}ms)`, { directory, filepath }, { error: err.message });
    throw new Error(`Failed to get file diff: ${err.message}`);
  }
}

/**
 * Parse git diff --name-status output into a status map
 */
function parseNameStatus(output: string): Map<string, 'modified' | 'added' | 'deleted' | 'renamed'> {
  const statusMap = new Map<string, 'modified' | 'added' | 'deleted' | 'renamed'>()
  for (const line of output.trim().split('\n')) {
    if (!line) continue
    const [status, ...pathParts] = line.split('\t')
    const filepath = pathParts.join('\t')
    if (status.startsWith('M')) {
      statusMap.set(filepath, 'modified')
    } else if (status.startsWith('A')) {
      statusMap.set(filepath, 'added')
    } else if (status.startsWith('D')) {
      statusMap.set(filepath, 'deleted')
    } else if (status.startsWith('R')) {
      statusMap.set(filepath, 'renamed')
    }
  }
  return statusMap
}

/**
 * Parse git diff --numstat output into DiffFile array and totals
 */
function parseNumstat(
  output: string,
  statusMap: Map<string, 'modified' | 'added' | 'deleted' | 'renamed'>
): { files: DiffFile[]; totalAdditions: number; totalDeletions: number } {
  const files: DiffFile[] = []
  let totalAdditions = 0
  let totalDeletions = 0

  for (const line of output.trim().split('\n')) {
    if (!line) continue
    if (files.length >= MAX_FILES) break

    const [addStr, delStr, ...pathParts] = line.split('\t')
    const filepath = pathParts.join('\t')

    const isBinary = addStr === '-' && delStr === '-'
    const additions = isBinary ? 0 : parseInt(addStr, 10) || 0
    const deletions = isBinary ? 0 : parseInt(delStr, 10) || 0

    files.push({
      path: filepath,
      status: statusMap.get(filepath) || 'modified',
      additions,
      deletions,
      isBinary,
    })

    totalAdditions += additions
    totalDeletions += deletions
  }

  return { files, totalAdditions, totalDeletions }
}

/**
 * Get changed files between a base ref and HEAD (three-dot diff)
 * Used for headless agents to see all changes since branch creation
 *
 * @param directory - Repository working directory
 * @param baseRef - Base reference (e.g., 'origin/main')
 * @returns DiffResult with files and summary statistics
 */
export async function getChangedFilesFromRef(directory: string, baseRef: string): Promise<DiffResult> {
  const startTime = Date.now()
  logger.debug('git-diff', 'Getting changed files from ref', { directory }, { baseRef })

  if (!await isGitRepo(directory)) {
    return { files: [], summary: { filesChanged: 0, additions: 0, deletions: 0 } }
  }

  try {
    const gitPath = getGitPath()

    // Three-dot diff: only changes on this branch since fork point (excludes upstream)
    const { stdout: committedStatus } = await execFileAsync(
      gitPath,
      ['diff', `${baseRef}...HEAD`, '--name-status'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    )

    const { stdout: committedNumstat } = await execFileAsync(
      gitPath,
      ['diff', `${baseRef}...HEAD`, '--numstat'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    )

    // Also include uncommitted changes (working tree vs HEAD)
    const { stdout: uncommittedStatus } = await execFileAsync(
      gitPath,
      ['diff', 'HEAD', '--name-status'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    )

    const { stdout: uncommittedNumstat } = await execFileAsync(
      gitPath,
      ['diff', 'HEAD', '--numstat'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    )

    // Merge committed + uncommitted, uncommitted takes priority for overlapping files
    const committedStatusMap = parseNameStatus(committedStatus)
    const uncommittedStatusMap = parseNameStatus(uncommittedStatus)
    const mergedStatusMap = new Map([...committedStatusMap, ...uncommittedStatusMap])

    // Merge numstat: parse both, deduplicate by path (uncommitted wins)
    const committedFiles = parseNumstat(committedNumstat, committedStatusMap)
    const uncommittedFiles = parseNumstat(uncommittedNumstat, uncommittedStatusMap)

    const fileMap = new Map<string, DiffFile>()
    for (const f of committedFiles.files) {
      fileMap.set(f.path, f)
    }
    for (const f of uncommittedFiles.files) {
      fileMap.set(f.path, f) // Overwrite with uncommitted version
    }

    const files = Array.from(fileMap.values())
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

    // Also include untracked files
    const { stdout: untrackedOutput } = await execFileAsync(
      gitPath,
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    )

    const trackedPaths = new Set(files.map(f => f.path))
    for (const line of untrackedOutput.trim().split('\n')) {
      if (!line || trackedPaths.has(line)) continue
      if (files.length >= MAX_FILES) break
      files.push({
        path: line,
        status: 'untracked',
        additions: 0,
        deletions: 0,
        isBinary: false,
      })
    }

    const duration = Date.now() - startTime
    logger.debug('git-diff', `Found ${files.length} changed files from ref (${duration}ms)`, { directory })

    return {
      files,
      summary: { filesChanged: files.length, additions: totalAdditions, deletions: totalDeletions },
    }
  } catch (error) {
    const err = error as Error
    const duration = Date.now() - startTime
    logger.error('git-diff', `Failed to get changed files from ref (${duration}ms)`, { directory }, { error: err.message })
    throw new Error(`Failed to get changed files from ref: ${err.message}`)
  }
}

/**
 * Get the diff content for a specific file compared to a base ref
 * Returns old and new content for side-by-side comparison
 *
 * @param directory - Repository working directory
 * @param filepath - Relative path to file from repository root
 * @param baseRef - Base reference (e.g., 'origin/main')
 * @returns FileDiffContent with old/new content and metadata
 */
export async function getFileDiffFromRef(
  directory: string,
  filepath: string,
  baseRef: string,
  force?: boolean
): Promise<FileDiffContent> {
  const startTime = Date.now()
  logger.debug('git-diff', `Getting file diff from ref${force ? ' (force)' : ''}`, { directory, filepath }, { baseRef })

  if (!await isGitRepo(directory)) {
    return { oldContent: '', newContent: '', language: detectLanguage(filepath), isBinary: false, isTooLarge: false, error: 'Not a git repository' }
  }

  try {
    const gitPath = getGitPath()
    const fullPath = path.join(directory, filepath)
    const language = detectLanguage(filepath)

    // Check file size (skip when force=true)
    try {
      const stats = await fs.stat(fullPath)
      if (!force && stats.size > MAX_FILE_SIZE_BYTES) {
        return { oldContent: '', newContent: '', language, isBinary: false, isTooLarge: true }
      }
    } catch {
      // File might be deleted
    }

    // Get old content from merge-base
    let oldContent = ''
    try {
      // Find the merge-base between baseRef and HEAD
      const { stdout: mergeBase } = await execFileAsync(
        gitPath,
        ['merge-base', baseRef, 'HEAD'],
        { cwd: directory }
      )
      const { stdout } = await execFileAsync(
        gitPath,
        ['show', `${mergeBase.trim()}:${filepath}`],
        { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
      )
      oldContent = stdout
    } catch {
      // File didn't exist at merge-base (newly added)
      oldContent = ''
    }

    // Get new content (working directory first, fall back to staged index)
    let newContent = ''
    try {
      await fs.access(fullPath)
      const buffer = await fs.readFile(fullPath)
      const sampleSize = Math.min(buffer.length, 8192)
      const isBinary = buffer.slice(0, sampleSize).includes(0)
      if (isBinary) {
        return { oldContent: '', newContent: '', language, isBinary: true, isTooLarge: false }
      }
      newContent = buffer.toString('utf8')

      // If working tree matches old content, check staged index for changes
      if (newContent === oldContent) {
        try {
          const { stdout: stagedContent } = await execFileAsync(
            gitPath,
            ['show', `:${filepath}`],
            { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
          )
          if (stagedContent !== oldContent) {
            newContent = stagedContent
          }
        } catch {
          // No staged version
        }
      }
    } catch (error) {
      const err = error as Error & { code?: string }
      if (err.code === 'ENOENT') {
        // File deleted from working tree - check staged index
        try {
          const { stdout: stagedContent } = await execFileAsync(
            gitPath,
            ['show', `:${filepath}`],
            { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
          )
          newContent = stagedContent
        } catch {
          newContent = '' // Truly deleted
        }
      } else {
        return { oldContent: '', newContent: '', language, isBinary: false, isTooLarge: false, error: `Failed to read file: ${err.message}` }
      }
    }

    const duration = Date.now() - startTime
    logger.debug('git-diff', `Retrieved file diff from ref (${duration}ms)`, { directory, filepath })

    return { oldContent, newContent, language, isBinary: false, isTooLarge: false }
  } catch (error) {
    const err = error as Error
    throw new Error(`Failed to get file diff from ref: ${err.message}`)
  }
}

/**
 * Get changed files for a specific commit
 *
 * @param directory - Repository working directory
 * @param commitSha - The commit SHA to inspect
 * @returns DiffResult with files changed in that commit
 */
export async function getChangedFilesForCommit(directory: string, commitSha: string): Promise<DiffResult> {
  const startTime = Date.now()
  logger.debug('git-diff', 'Getting changed files for commit', { directory }, { commitSha })

  if (!await isGitRepo(directory)) {
    return { files: [], summary: { filesChanged: 0, additions: 0, deletions: 0 } }
  }

  try {
    const gitPath = getGitPath()

    // Check if this is the root commit (no parent)
    let diffArgs: string[]
    try {
      await execFileAsync(gitPath, ['rev-parse', `${commitSha}^`], { cwd: directory })
      diffArgs = ['diff', `${commitSha}^..${commitSha}`]
    } catch {
      // Root commit - diff against empty tree
      diffArgs = ['diff', '--root', commitSha]
    }

    const { stdout: statusOutput } = await execFileAsync(
      gitPath,
      [...diffArgs, '--name-status'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    )

    const { stdout: numstatOutput } = await execFileAsync(
      gitPath,
      [...diffArgs, '--numstat'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    )

    const statusMap = parseNameStatus(statusOutput)
    const { files, totalAdditions, totalDeletions } = parseNumstat(numstatOutput, statusMap)

    const duration = Date.now() - startTime
    logger.debug('git-diff', `Found ${files.length} changed files for commit (${duration}ms)`, { directory })

    return {
      files,
      summary: { filesChanged: files.length, additions: totalAdditions, deletions: totalDeletions },
    }
  } catch (error) {
    const err = error as Error
    throw new Error(`Failed to get changed files for commit: ${err.message}`)
  }
}

/**
 * Get the diff content for a specific file in a specific commit
 *
 * @param directory - Repository working directory
 * @param filepath - Relative path to file from repository root
 * @param commitSha - The commit SHA to inspect
 * @returns FileDiffContent with old/new content and metadata
 */
export async function getFileDiffForCommit(
  directory: string,
  filepath: string,
  commitSha: string,
  force?: boolean
): Promise<FileDiffContent> {
  const startTime = Date.now()
  logger.debug('git-diff', `Getting file diff for commit${force ? ' (force)' : ''}`, { directory, filepath }, { commitSha })

  if (!await isGitRepo(directory)) {
    return { oldContent: '', newContent: '', language: detectLanguage(filepath), isBinary: false, isTooLarge: false, error: 'Not a git repository' }
  }

  try {
    const gitPath = getGitPath()
    const language = detectLanguage(filepath)

    // Get old content (from parent commit)
    let oldContent = ''
    try {
      const { stdout } = await execFileAsync(
        gitPath,
        ['show', `${commitSha}^:${filepath}`],
        { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
      )
      oldContent = stdout
    } catch {
      // File didn't exist before this commit
      oldContent = ''
    }

    // Get new content (from this commit)
    let newContent = ''
    try {
      const { stdout } = await execFileAsync(
        gitPath,
        ['show', `${commitSha}:${filepath}`],
        { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
      )
      newContent = stdout

      // Check if binary
      if (Buffer.from(newContent).slice(0, 8192).includes(0)) {
        return { oldContent: '', newContent: '', language, isBinary: true, isTooLarge: false }
      }

      // Check file size (skip when force=true)
      if (!force && newContent.length > MAX_FILE_SIZE_BYTES) {
        return { oldContent: '', newContent: '', language, isBinary: false, isTooLarge: true }
      }
    } catch {
      // File was deleted in this commit
      newContent = ''
    }

    const duration = Date.now() - startTime
    logger.debug('git-diff', `Retrieved file diff for commit (${duration}ms)`, { directory, filepath })

    return { oldContent, newContent, language, isBinary: false, isTooLarge: false }
  } catch (error) {
    const err = error as Error
    throw new Error(`Failed to get file diff for commit: ${err.message}`)
  }
}

/**
 * Validate that a filepath doesn't contain path traversal
 */
function validateFilepath(filepath: string): void {
  if (filepath.includes('..') || path.isAbsolute(filepath)) {
    throw new Error('Invalid filepath: path traversal not allowed');
  }
}

/**
 * Revert a single file to HEAD
 * - For files that exist in HEAD: git checkout HEAD -- <filepath>
 * - For added files (not in HEAD): delete the file
 */
export async function revertFile(directory: string, filepath: string): Promise<void> {
  validateFilepath(filepath);
  logger.debug('git-diff', 'Reverting file', { directory, filepath });

  const gitPath = getGitPath();
  const hasHead = await hasHeadCommit(directory);

  if (!hasHead) {
    // No HEAD commit - all files are "added", just delete them
    const fullPath = path.join(directory, filepath);
    await fs.unlink(fullPath);
    logger.debug('git-diff', 'Deleted added file (no HEAD)', { directory, filepath });
    return;
  }

  // Check if the file exists in HEAD
  let existsInHead = false;
  try {
    await execFileAsync(gitPath, ['cat-file', '-e', `HEAD:${filepath}`], { cwd: directory });
    existsInHead = true;
  } catch {
    existsInHead = false;
  }

  if (existsInHead) {
    // File exists in HEAD - checkout from HEAD
    await execFileAsync(gitPath, ['checkout', 'HEAD', '--', filepath], { cwd: directory });
    logger.debug('git-diff', 'Reverted file to HEAD', { directory, filepath });
  } else {
    // File is newly added (not in HEAD) - delete it
    const fullPath = path.join(directory, filepath);
    await fs.unlink(fullPath);
    logger.debug('git-diff', 'Deleted added file', { directory, filepath });
  }
}

/**
 * Write edited content to a file
 */
export async function writeFileContent(directory: string, filepath: string, content: string): Promise<void> {
  validateFilepath(filepath);
  const fullPath = path.join(directory, filepath);
  await fs.writeFile(fullPath, content, 'utf8');
  logger.debug('git-diff', 'Wrote file content', { directory, filepath, size: content.length });
}

/**
 * Revert all changed files to HEAD
 * Gets the file list via getChangedFiles(), then reverts each individually
 */
export async function revertAllFiles(directory: string): Promise<void> {
  logger.debug('git-diff', 'Reverting all files', { directory });

  const result = await getChangedFiles(directory);
  if (result.files.length === 0) return;

  for (const file of result.files) {
    try {
      await revertFile(directory, file.path);
    } catch (error) {
      const err = error as Error;
      logger.error('git-diff', 'Failed to revert file during revert-all', { directory, filepath: file.path }, { error: err.message });
      // Continue reverting other files
    }
  }

  logger.debug('git-diff', `Reverted ${result.files.length} files`, { directory });
}
