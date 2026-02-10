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
import { validateFilepath } from './path-utils';
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

    // Get file status (modified, added, deleted, renamed)
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
      if (files.length >= MAX_FILES) {
        logger.warn('git-diff', `Reached file limit (${MAX_FILES}), truncating results`, { directory });
        break;
      }

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

    // Get new content (from working directory)
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
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === 'ENOENT') {
        // File was deleted
        newContent = '';
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
