/**
 * Code browser operations for browsing and reading repository files
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { findBinary } from './exec-utils';
import type { FileTreeEntry, FileContent, GitBranch, GitLogEntry } from '../shared/types';

const execFileAsync = promisify(execFile);

// Safety limits
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
 * Validate that a filepath doesn't contain path traversal
 */
function validateFilepath(filepath: string): void {
  if (filepath.includes('..') || path.isAbsolute(filepath)) {
    throw new Error('Invalid filepath: path traversal not allowed');
  }
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
 * Get file tree for a repository
 * Lists all tracked files from git and untracked files from working directory
 */
export async function getFileTree(directory: string, ref?: string): Promise<FileTreeEntry[]> {
  const startTime = Date.now();
  logger.debug('code-browser', 'Getting file tree', { directory, ref });

  try {
    const gitPath = getGitPath();
    const fileSet = new Set<string>();
    const entries: FileTreeEntry[] = [];

    // Get tracked files from git
    try {
      const targetRef = ref || 'HEAD';
      const { stdout } = await execFileAsync(
        gitPath,
        ['ls-tree', '-r', '--name-only', targetRef],
        {
          cwd: directory,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const trackedFiles = stdout.trim().split('\n').filter(f => f);
      for (const file of trackedFiles) {
        fileSet.add(file);
        entries.push({
          path: file,
          type: 'file',
        });
      }
    } catch (error) {
      const err = error as Error;
      logger.debug('code-browser', 'No tracked files or invalid ref', { directory, ref }, { error: err.message });
    }

    // Get untracked files (only if no ref specified, i.e., working directory)
    if (!ref) {
      try {
        const { stdout } = await execFileAsync(
          gitPath,
          ['ls-files', '--others', '--exclude-standard'],
          {
            cwd: directory,
            maxBuffer: 10 * 1024 * 1024,
          }
        );

        const untrackedFiles = stdout.trim().split('\n').filter(f => f);
        for (const file of untrackedFiles) {
          if (!fileSet.has(file)) {
            fileSet.add(file);
            entries.push({
              path: file,
              type: 'file',
            });
          }
        }
      } catch (error) {
        const err = error as Error;
        logger.debug('code-browser', 'Failed to get untracked files', { directory }, { error: err.message });
      }
    }

    // Sort entries by path
    entries.sort((a, b) => a.path.localeCompare(b.path));

    const duration = Date.now() - startTime;
    logger.debug(
      'code-browser',
      `Retrieved file tree (${duration}ms)`,
      { directory, ref },
      { fileCount: entries.length }
    );

    return entries;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('code-browser', `Failed to get file tree (${duration}ms)`, { directory, ref }, { error: err.message });
    throw new Error(`Failed to get file tree: ${err.message}`);
  }
}

/**
 * Get file content from repository
 * If ref is provided, reads from git. Otherwise reads from working directory.
 */
export async function getFileContent(
  directory: string,
  filepath: string,
  ref?: string
): Promise<FileContent> {
  validateFilepath(filepath);

  const startTime = Date.now();
  logger.debug('code-browser', 'Getting file content', { directory, filepath, ref });

  try {
    const language = detectLanguage(filepath);
    let content: string;
    let buffer: Buffer;

    if (ref) {
      // Read from git
      const gitPath = getGitPath();
      try {
        const { stdout } = await execFileAsync(
          gitPath,
          ['show', `${ref}:${filepath}`],
          {
            cwd: directory,
            maxBuffer: 10 * 1024 * 1024,
            encoding: 'buffer',
          }
        );
        buffer = stdout as Buffer;
      } catch (error) {
        const err = error as Error;
        logger.error('code-browser', 'Failed to read file from git', { directory, filepath, ref }, { error: err.message });
        return {
          content: '',
          language,
          isBinary: false,
          isTooLarge: false,
          error: `File not found in ${ref}`,
        };
      }
    } else {
      // Read from working directory
      const fullPath = path.join(directory, filepath);
      try {
        await fs.access(fullPath);
        buffer = await fs.readFile(fullPath);
      } catch (error) {
        const err = error as Error & { code?: string };
        if (err.code === 'ENOENT') {
          logger.debug('code-browser', 'File not found', { directory, filepath });
          return {
            content: '',
            language,
            isBinary: false,
            isTooLarge: false,
            error: 'File not found',
          };
        } else if (err.code === 'EACCES') {
          logger.error('code-browser', 'Permission denied reading file', { directory, filepath });
          return {
            content: '',
            language,
            isBinary: false,
            isTooLarge: false,
            error: 'Permission denied',
          };
        } else {
          logger.error('code-browser', 'Failed to read file', { directory, filepath }, { error: err.message });
          return {
            content: '',
            language,
            isBinary: false,
            isTooLarge: false,
            error: `Failed to read file: ${err.message}`,
          };
        }
      }
    }

    // Check if binary by looking for null bytes in first 8KB
    const sampleSize = Math.min(buffer.length, 8192);
    const isBinary = buffer.slice(0, sampleSize).includes(0);

    if (isBinary) {
      logger.debug('code-browser', 'File is binary', { directory, filepath, ref });
      return {
        content: '',
        language,
        isBinary: true,
        isTooLarge: false,
      };
    }

    // Check size limit
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      logger.debug('code-browser', 'File too large', { directory, filepath, ref }, { size: buffer.length });
      return {
        content: '',
        language,
        isBinary: false,
        isTooLarge: true,
        error: `File is too large (${Math.round(buffer.length / 1024)}KB). Maximum size is ${MAX_FILE_SIZE_BYTES / 1024}KB.`,
      };
    }

    content = buffer.toString('utf8');

    const duration = Date.now() - startTime;
    logger.debug(
      'code-browser',
      `Retrieved file content (${duration}ms)`,
      { directory, filepath, ref },
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
    logger.error('code-browser', `Failed to get file content (${duration}ms)`, { directory, filepath, ref }, { error: err.message });
    throw new Error(`Failed to get file content: ${err.message}`);
  }
}

/**
 * Get list of local git branches
 */
export async function getGitBranches(directory: string): Promise<GitBranch[]> {
  const startTime = Date.now();
  logger.debug('code-browser', 'Getting git branches', { directory });

  try {
    const gitPath = getGitPath();
    const { stdout } = await execFileAsync(
      gitPath,
      ['branch', '--list', '--format=%(refname:short)|%(HEAD)'],
      {
        cwd: directory,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const branches: GitBranch[] = stdout
      .trim()
      .split('\n')
      .filter(line => line)
      .map(line => {
        const [name, isCurrentMarker] = line.split('|');
        return {
          name: name.trim(),
          isCurrent: isCurrentMarker === '*',
        };
      });

    const duration = Date.now() - startTime;
    logger.debug(
      'code-browser',
      `Retrieved git branches (${duration}ms)`,
      { directory },
      { branchCount: branches.length }
    );

    return branches;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('code-browser', `Failed to get git branches (${duration}ms)`, { directory }, { error: err.message });
    throw new Error(`Failed to get git branches: ${err.message}`);
  }
}

/**
 * Get git log entries
 */
export async function getGitLog(directory: string, limit?: number): Promise<GitLogEntry[]> {
  const startTime = Date.now();
  const logLimit = limit || 50;
  logger.debug('code-browser', 'Getting git log', { directory, limit: logLimit });

  try {
    const gitPath = getGitPath();
    const { stdout } = await execFileAsync(
      gitPath,
      [
        'log',
        '--format=%H|%h|%s|%aI',
        `-n${logLimit}`,
      ],
      {
        cwd: directory,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const entries: GitLogEntry[] = stdout
      .trim()
      .split('\n')
      .filter(line => line)
      .map(line => {
        const [sha, shortSha, message, date] = line.split('|');
        return {
          sha,
          shortSha,
          message,
          date,
        };
      });

    const duration = Date.now() - startTime;
    logger.debug(
      'code-browser',
      `Retrieved git log (${duration}ms)`,
      { directory, limit: logLimit },
      { entryCount: entries.length }
    );

    return entries;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('code-browser', `Failed to get git log (${duration}ms)`, { directory, limit: logLimit }, { error: err.message });
    throw new Error(`Failed to get git log: ${err.message}`);
  }
}
