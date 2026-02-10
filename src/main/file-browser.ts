/**
 * File browser operations for exploring repository file trees and reading file contents
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { findBinary } from './exec-utils';
import { isGitRepo } from './git-utils';
import { validateFilepath } from './path-utils';
import type { FileEntry, FileContentResult, FileSearchResult } from '../shared/types';

const execFileAsync = promisify(execFile);

// Safety limits
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB hard limit
const WARN_FILE_SIZE_BYTES = 100 * 1024; // 100KB warning threshold
const MAX_SEARCH_RESULTS = 1000;

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
 * List contents of a directory in a git repository
 * Respects .gitignore by using git ls-files for tracked files
 * and git ls-files --others --exclude-standard for untracked files
 *
 * @param directory - Repository root directory
 * @param relativePath - Optional subdirectory path relative to repository root
 * @returns Array of FileEntry objects
 */
export async function listDirectory(
  directory: string,
  relativePath?: string
): Promise<FileEntry[]> {
  const startTime = Date.now();
  logger.debug('git', 'Listing directory', { directory });

  // Validate directory is a git repo
  if (!await isGitRepo(directory)) {
    logger.error('git', 'Not a git repository', { directory });
    throw new Error('Not a git repository');
  }

  // Validate relativePath if provided
  if (relativePath) {
    validateFilepath(relativePath);
  }

  const targetPath = relativePath ? path.join(directory, relativePath) : directory;

  try {
    const gitPath = getGitPath();

    // Get all tracked files
    const { stdout: trackedOutput } = await execFileAsync(
      gitPath,
      ['ls-files', relativePath || '.'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Get all untracked files (respecting .gitignore)
    const { stdout: untrackedOutput } = await execFileAsync(
      gitPath,
      ['ls-files', '--others', '--exclude-standard', relativePath || '.'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Combine tracked and untracked files
    const allFiles = [
      ...trackedOutput.trim().split('\n').filter(Boolean),
      ...untrackedOutput.trim().split('\n').filter(Boolean),
    ];

    // Build directory entries
    const entriesMap = new Map<string, FileEntry>();

    for (const filePath of allFiles) {
      // Skip if file is not in the target subdirectory
      if (relativePath && !filePath.startsWith(relativePath)) {
        continue;
      }

      // Get the path relative to the target directory
      const relPath = relativePath ? filePath.substring(relativePath.length + 1) : filePath;

      // Only include direct children (no nested paths)
      const firstSlash = relPath.indexOf('/');
      if (firstSlash === -1) {
        // It's a file in this directory
        const fullPath = path.join(directory, filePath);
        try {
          const stats = await fs.stat(fullPath);
          const isSymlink = (await fs.lstat(fullPath)).isSymbolicLink();

          entriesMap.set(relPath, {
            name: path.basename(filePath),
            path: filePath,
            type: 'file',
            size: stats.size,
            isSymlink,
          });
        } catch {
          // File might have been deleted, skip it
          continue;
        }
      } else {
        // It's a directory (extract the first segment)
        const dirName = relPath.substring(0, firstSlash);
        const dirPath = relativePath ? path.join(relativePath, dirName) : dirName;

        if (!entriesMap.has(dirName)) {
          entriesMap.set(dirName, {
            name: dirName,
            path: dirPath,
            type: 'directory',
            isSymlink: false,
          });
        }
      }
    }

    // Convert to array and sort (directories first, then files, both alphabetically)
    const entries = Array.from(entriesMap.values()).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const duration = Date.now() - startTime;
    logger.debug(
      'git',
      `Listed ${entries.length} entries (${duration}ms)`,
      { directory }
    );

    return entries;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error(
      'git',
      `Failed to list directory (${duration}ms)`,
      { directory },
      { error: err.message }
    );
    throw new Error(`Failed to list directory: ${err.message}`);
  }
}

/**
 * Get full recursive file tree for a repository
 * Uses git ls-tree for tracked files and git ls-files for untracked files
 *
 * @param directory - Repository root directory
 * @returns Array of all file paths in the repository
 */
export async function getFileTree(directory: string): Promise<string[]> {
  const startTime = Date.now();
  logger.debug('git', 'Getting file tree', { directory });

  // Validate directory is a git repo
  if (!await isGitRepo(directory)) {
    logger.error('git', 'Not a git repository', { directory });
    throw new Error('Not a git repository');
  }

  try {
    const gitPath = getGitPath();

    // Get all tracked files recursively
    const { stdout: trackedOutput } = await execFileAsync(
      gitPath,
      ['ls-tree', '-r', '--name-only', 'HEAD'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Get all untracked files (respecting .gitignore)
    const { stdout: untrackedOutput } = await execFileAsync(
      gitPath,
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Combine and deduplicate
    const trackedFiles = trackedOutput.trim().split('\n').filter(Boolean);
    const untrackedFiles = untrackedOutput.trim().split('\n').filter(Boolean);
    const allFiles = [...new Set([...trackedFiles, ...untrackedFiles])];

    const duration = Date.now() - startTime;
    logger.debug(
      'git',
      `Found ${allFiles.length} files (${duration}ms)`,
      { directory }
    );

    return allFiles;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error(
      'git',
      `Failed to get file tree (${duration}ms)`,
      { directory },
      { error: err.message }
    );
    throw new Error(`Failed to get file tree: ${err.message}`);
  }
}

/**
 * Read arbitrary file content from a repository
 * Validates filepath, checks file size, and detects binary files
 *
 * @param directory - Repository root directory
 * @param filepath - Relative path to file from repository root
 * @param force - Skip size warnings and read anyway
 * @returns FileContentResult with content and metadata
 */
export async function readFileContent(
  directory: string,
  filepath: string,
  force?: boolean
): Promise<FileContentResult> {
  const startTime = Date.now();
  logger.debug('git', `Reading file${force ? ' (force)' : ''}`, { directory, filepath });

  // Validate directory is a git repo
  if (!await isGitRepo(directory)) {
    logger.error('git', 'Not a git repository', { directory });
    return {
      content: '',
      language: detectLanguage(filepath),
      isBinary: false,
      size: 0,
      isTooLarge: false,
      error: 'Not a git repository',
    };
  }

  // Validate filepath
  validateFilepath(filepath);

  const fullPath = path.join(directory, filepath);
  const language = detectLanguage(filepath);

  try {
    // Check if file exists
    const stats = await fs.stat(fullPath);
    const size = stats.size;

    // Check size limits
    if (size > MAX_FILE_SIZE_BYTES) {
      logger.warn('git', 'File exceeds maximum size', { directory, filepath, size });
      return {
        content: '',
        language,
        isBinary: false,
        size,
        isTooLarge: true,
        error: `File size (${Math.round(size / 1024)}KB) exceeds maximum limit (${MAX_FILE_SIZE_BYTES / 1024}KB)`,
      };
    }

    if (!force && size > WARN_FILE_SIZE_BYTES) {
      logger.warn('git', 'File is large', { directory, filepath, size });
      return {
        content: '',
        language,
        isBinary: false,
        size,
        isTooLarge: true,
        error: `File is large (${Math.round(size / 1024)}KB). Use force option to read anyway.`,
      };
    }

    // Read file content
    const buffer = await fs.readFile(fullPath);

    // Detect binary files by checking for null bytes in first 8KB
    const sampleSize = Math.min(buffer.length, 8192);
    const isBinary = buffer.slice(0, sampleSize).includes(0);

    if (isBinary) {
      logger.debug('git', 'File is binary', { directory, filepath, size });
      return {
        content: '',
        language,
        isBinary: true,
        size,
        isTooLarge: false,
      };
    }

    const content = buffer.toString('utf8');

    const duration = Date.now() - startTime;
    logger.debug(
      'git',
      `Read file (${duration}ms)`,
      { directory, filepath },
      { size, contentLength: content.length }
    );

    return {
      content,
      language,
      isBinary: false,
      size,
      isTooLarge: false,
    };
  } catch (error) {
    const err = error as Error & { code?: string };
    const duration = Date.now() - startTime;

    if (err.code === 'ENOENT') {
      logger.error('git', 'File not found', { directory, filepath });
      return {
        content: '',
        language,
        isBinary: false,
        size: 0,
        isTooLarge: false,
        error: 'File not found',
      };
    }

    if (err.code === 'EACCES') {
      logger.error('git', 'Permission denied', { directory, filepath });
      return {
        content: '',
        language,
        isBinary: false,
        size: 0,
        isTooLarge: false,
        error: 'Permission denied',
      };
    }

    logger.error(
      'git',
      `Failed to read file (${duration}ms)`,
      { directory, filepath },
      { error: err.message }
    );
    return {
      content: '',
      language,
      isBinary: false,
      size: 0,
      isTooLarge: false,
      error: `Failed to read file: ${err.message}`,
    };
  }
}

/**
 * Search for files by name pattern in a repository
 * Uses git ls-files with glob pattern matching
 *
 * @param directory - Repository root directory
 * @param query - Search query (glob pattern)
 * @returns FileSearchResult with matching file paths
 */
export async function searchFiles(
  directory: string,
  query: string
): Promise<FileSearchResult> {
  const startTime = Date.now();
  logger.debug('git', 'Searching files', { directory });

  // Validate directory is a git repo
  if (!await isGitRepo(directory)) {
    logger.error('git', 'Not a git repository', { directory });
    return {
      files: [],
      error: 'Not a git repository',
    };
  }

  try {
    const gitPath = getGitPath();

    // Search in tracked files
    const { stdout: trackedOutput } = await execFileAsync(
      gitPath,
      ['ls-files', `*${query}*`],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Search in untracked files (respecting .gitignore)
    const { stdout: untrackedOutput } = await execFileAsync(
      gitPath,
      ['ls-files', '--others', '--exclude-standard', `*${query}*`],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Combine and deduplicate results
    const trackedFiles = trackedOutput.trim().split('\n').filter(Boolean);
    const untrackedFiles = untrackedOutput.trim().split('\n').filter(Boolean);
    const allMatches = [...new Set([...trackedFiles, ...untrackedFiles])];

    // Limit results
    const files = allMatches.slice(0, MAX_SEARCH_RESULTS);

    const duration = Date.now() - startTime;
    logger.debug(
      'git',
      `Found ${files.length} matching files (${duration}ms)`,
      { directory }
    );

    return { files };
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error(
      'git',
      `Failed to search files (${duration}ms)`,
      { directory },
      { error: err.message }
    );
    return {
      files: [],
      error: `Failed to search files: ${err.message}`,
    };
  }
}
