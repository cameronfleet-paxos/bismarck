/**
 * Git file browsing operations for reading repository file trees and contents
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { findBinary } from './exec-utils';
import { isGitRepo } from './git-utils';
import type { FileTreeResult, FileContent } from '../shared/types';

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
 * Validate that a filepath doesn't contain path traversal
 */
function validateFilepath(filepath: string): void {
  if (filepath.includes('..') || path.isAbsolute(filepath)) {
    throw new Error('Invalid filepath: path traversal not allowed');
  }
}

/**
 * Get the file tree for a repository
 * Returns list of tracked and untracked files
 *
 * @param directory - Repository working directory
 * @returns FileTreeResult with files and metadata
 */
export async function getFileTree(directory: string): Promise<FileTreeResult> {
  const startTime = Date.now();
  logger.debug('git-browse', 'Getting file tree', { directory });

  // Return empty result for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-browse', 'Not a git repository, returning empty result', { directory });
    return {
      files: [],
      totalFiles: 0,
      truncated: false,
    };
  }

  try {
    const gitPath = getGitPath();
    const allFiles = new Set<string>();

    // Get tracked files at HEAD
    try {
      const { stdout: trackedOutput } = await execFileAsync(
        gitPath,
        ['ls-tree', '-r', '--name-only', 'HEAD'],
        { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
      );

      for (const line of trackedOutput.trim().split('\n')) {
        if (line.length > 0) {
          allFiles.add(line);
        }
      }
    } catch (error) {
      // No HEAD commit yet - that's okay, continue to untracked files
      const err = error as Error;
      if (!err.message.includes('Not a valid object name')) {
        logger.warn('git-browse', 'Failed to list tracked files', { directory }, { error: err.message });
      }
    }

    // Get untracked files (working tree)
    try {
      const { stdout: untrackedOutput } = await execFileAsync(
        gitPath,
        ['ls-files', '--others', '--exclude-standard'],
        { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
      );

      for (const line of untrackedOutput.trim().split('\n')) {
        if (line.length > 0) {
          allFiles.add(line);
        }
      }
    } catch (error) {
      const err = error as Error;
      logger.warn('git-browse', 'Failed to list untracked files', { directory }, { error: err.message });
    }

    // Convert to sorted array and check for truncation
    const sortedFiles = Array.from(allFiles).sort();
    const truncated = sortedFiles.length > MAX_FILES;
    const files = sortedFiles.slice(0, MAX_FILES).map(filepath => ({
      path: filepath,
      isTracked: true, // For now, we just mark all files as tracked (we could enhance this later)
    }));

    const duration = Date.now() - startTime;
    logger.debug(
      'git-browse',
      `Found ${files.length} files (${duration}ms)${truncated ? ` (truncated from ${sortedFiles.length})` : ''}`,
      { directory }
    );

    return {
      files,
      totalFiles: sortedFiles.length,
      truncated,
    };
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('git-browse', `Failed to get file tree (${duration}ms)`, { directory }, { error: err.message });
    throw new Error(`Failed to get file tree: ${err.message}`);
  }
}

/**
 * Read file content from the working directory
 * Returns file content with language detection and binary/size checks
 *
 * @param directory - Repository working directory
 * @param filepath - Relative path to file from repository root
 * @param force - If true, bypass size limit checks
 * @returns FileContent with content and metadata
 */
export async function readFileContent(directory: string, filepath: string, force?: boolean): Promise<FileContent> {
  const startTime = Date.now();
  logger.debug('git-browse', `Reading file content${force ? ' (force)' : ''}`, { directory, filepath });

  // Validate filepath
  validateFilepath(filepath);

  // Return error for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('git-browse', 'Not a git repository', { directory });
    return {
      content: '',
      language: detectLanguage(filepath),
      isBinary: false,
      isTooLarge: false,
      error: 'Not a git repository',
    };
  }

  try {
    const fullPath = path.join(directory, filepath);
    const language = detectLanguage(filepath);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === 'ENOENT') {
        logger.debug('git-browse', 'File not found', { directory, filepath });
        return {
          content: '',
          language,
          isBinary: false,
          isTooLarge: false,
          error: 'File not found',
        };
      }
      throw error;
    }

    // Check file size (skip when force=true)
    const stats = await fs.stat(fullPath);
    if (!force && stats.size > MAX_FILE_SIZE_BYTES) {
      logger.warn('git-browse', 'File is too large to display', { directory, filepath, size: stats.size });
      return {
        content: '',
        language,
        isBinary: false,
        isTooLarge: true,
      };
    }

    // Read file content
    const buffer = await fs.readFile(fullPath);

    // Check if binary by looking for null bytes in first 8KB
    const sampleSize = Math.min(buffer.length, 8192);
    const isBinary = buffer.slice(0, sampleSize).includes(0);

    if (isBinary) {
      logger.debug('git-browse', 'File is binary', { directory, filepath });
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
      'git-browse',
      `Read file content (${duration}ms)`,
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
    const err = error as Error & { code?: string };
    const duration = Date.now() - startTime;

    if (err.code === 'EACCES') {
      logger.error('git-browse', 'Permission denied reading file', { directory, filepath });
      return {
        content: '',
        language: detectLanguage(filepath),
        isBinary: false,
        isTooLarge: false,
        error: 'Permission denied',
      };
    }

    logger.error('git-browse', `Failed to read file content (${duration}ms)`, { directory, filepath }, { error: err.message });
    return {
      content: '',
      language: detectLanguage(filepath),
      isBinary: false,
      isTooLarge: false,
      error: `Failed to read file: ${err.message}`,
    };
  }
}
