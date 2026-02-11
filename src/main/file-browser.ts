/**
 * File browsing operations for code editor
 * Provides directory tree listing, file reading, and git history
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { findBinary } from './exec-utils';
import { isGitRepo } from './git-utils';
import type { FileTreeNode, FileContent, GitCommitInfo } from '../shared/types';

const execFileAsync = promisify(execFile);

// Safety limits
const MAX_FILE_SIZE_BYTES = 100 * 1024; // 100KB
const MAX_DIRECTORY_DEPTH = 10;
const MAX_GIT_LOG_COMMITS = 100;

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
 * Check if content is binary by looking for null bytes
 */
function isBinaryContent(content: Buffer): boolean {
  // Check first 8KB for null bytes (binary indicator)
  const checkSize = Math.min(content.length, 8192);
  for (let i = 0; i < checkSize; i++) {
    if (content[i] === 0) return true;
  }
  return false;
}

/**
 * Get directory tree structure
 * Uses git ls-files to respect .gitignore automatically
 *
 * @param directory - Repository working directory
 * @param options - Optional parameters (maxDepth, etc.)
 * @returns FileTreeNode representing the directory tree
 */
export async function getDirectoryTree(
  directory: string,
  options?: { maxDepth?: number }
): Promise<FileTreeNode> {
  const startTime = Date.now();
  const maxDepth = options?.maxDepth ?? MAX_DIRECTORY_DEPTH;

  logger.debug('file-browser', 'Getting directory tree', { directory });

  // Return empty tree for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('file-browser', 'Not a git repository, returning empty tree', { directory });
    return {
      name: path.basename(directory),
      path: '',
      type: 'directory',
      children: [],
    };
  }

  try {
    const gitPath = getGitPath();

    // Get all tracked files (respects .gitignore)
    const { stdout: trackedFiles } = await execFileAsync(
      gitPath,
      ['ls-files'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Get untracked files (excluding ignored)
    const { stdout: untrackedFiles } = await execFileAsync(
      gitPath,
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    // Combine and dedupe
    const allFiles = new Set([
      ...trackedFiles.trim().split('\n').filter(Boolean),
      ...untrackedFiles.trim().split('\n').filter(Boolean),
    ]);

    // Build tree structure
    const root: FileTreeNode = {
      name: path.basename(directory),
      path: '',
      type: 'directory',
      children: [],
    };

    const dirMap = new Map<string, FileTreeNode>();
    dirMap.set('', root);

    for (const filepath of allFiles) {
      const parts = filepath.split('/');
      const depth = parts.length - 1;

      // Skip if exceeds max depth
      if (depth > maxDepth) continue;

      // Create directory nodes as needed
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

        if (!dirMap.has(currentPath)) {
          const dirNode: FileTreeNode = {
            name: parts[i],
            path: currentPath,
            type: 'directory',
            children: [],
          };
          dirMap.set(currentPath, dirNode);

          const parent = dirMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(dirNode);
          }
        }
      }

      // Add file node
      const fileName = parts[parts.length - 1];
      const fileNode: FileTreeNode = {
        name: fileName,
        path: filepath,
        type: 'file',
        extension: path.extname(fileName).slice(1), // Remove leading dot
      };

      // Get file size
      try {
        const stats = await fs.stat(path.join(directory, filepath));
        fileNode.size = stats.size;
      } catch {
        // Ignore stat errors
      }

      const parentPath = parts.slice(0, -1).join('/');
      const parent = dirMap.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(fileNode);
      }
    }

    // Sort children alphabetically (directories first, then files)
    function sortChildren(node: FileTreeNode): void {
      if (node.children) {
        node.children.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
        node.children.forEach(sortChildren);
      }
    }
    sortChildren(root);

    const duration = Date.now() - startTime;
    logger.debug('file-browser', `Built directory tree (${duration}ms)`, { directory });

    return root;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('file-browser', `Failed to get directory tree (${duration}ms)`, { directory }, { error: err.message });
    throw new Error(`Failed to get directory tree: ${err.message}`);
  }
}

/**
 * Read file content with metadata
 *
 * @param directory - Repository working directory
 * @param filepath - Relative path to file
 * @param options - Optional parameters (force to bypass size limit)
 * @returns FileContent with content and metadata
 */
export async function readFileContent(
  directory: string,
  filepath: string,
  options?: { force?: boolean }
): Promise<FileContent> {
  const startTime = Date.now();
  validateFilepath(filepath);

  logger.debug('file-browser', 'Reading file content', { directory, filepath });

  try {
    const fullPath = path.join(directory, filepath);
    const stats = await fs.stat(fullPath);
    const fileSize = stats.size;

    // Check size limit
    const isTooLarge = fileSize > MAX_FILE_SIZE_BYTES;
    if (isTooLarge && !options?.force) {
      logger.debug('file-browser', 'File too large, returning metadata only', { directory, filepath, size: fileSize });
      return {
        content: '',
        language: detectLanguage(filepath),
        isBinary: false,
        isTooLarge: true,
        size: fileSize,
        error: `File is ${Math.round(fileSize / 1024)}KB (limit: ${MAX_FILE_SIZE_BYTES / 1024}KB). Use force option to read anyway.`,
      };
    }

    // Read file content
    const buffer = await fs.readFile(fullPath);
    const isBinary = isBinaryContent(buffer);

    if (isBinary) {
      logger.debug('file-browser', 'Binary file detected', { directory, filepath });
      return {
        content: '',
        language: detectLanguage(filepath),
        isBinary: true,
        isTooLarge: false,
        size: fileSize,
        error: 'Binary file cannot be displayed as text',
      };
    }

    const content = buffer.toString('utf8');
    const language = detectLanguage(filepath);

    const duration = Date.now() - startTime;
    logger.debug('file-browser', `Read file content (${duration}ms)`, { directory, filepath, size: fileSize });

    return {
      content,
      language,
      isBinary: false,
      isTooLarge: false,
      size: fileSize,
    };
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('file-browser', `Failed to read file content (${duration}ms)`, { directory, filepath }, { error: err.message });
    throw new Error(`Failed to read file: ${err.message}`);
  }
}

/**
 * Get git commit history
 *
 * @param directory - Repository working directory
 * @param filepath - Optional: get history for specific file
 * @param options - Optional parameters (limit for number of commits)
 * @returns Array of GitCommitInfo
 */
export async function getGitLog(
  directory: string,
  filepath?: string,
  options?: { limit?: number }
): Promise<GitCommitInfo[]> {
  const startTime = Date.now();
  const limit = options?.limit ?? MAX_GIT_LOG_COMMITS;

  if (filepath) {
    validateFilepath(filepath);
  }

  logger.debug('file-browser', 'Getting git log', { directory, filepath });

  // Return empty for non-git directories
  if (!await isGitRepo(directory)) {
    logger.debug('file-browser', 'Not a git repository, returning empty log', { directory });
    return [];
  }

  try {
    const gitPath = getGitPath();

    // Build git log command
    // Format: hash|author|date|message
    const args = [
      'log',
      `--max-count=${limit}`,
      '--format=%H|%an|%aI|%s',
    ];

    // Add filepath if specified
    if (filepath) {
      args.push('--', filepath);
    }

    const { stdout } = await execFileAsync(
      gitPath,
      args,
      { cwd: directory, maxBuffer: 10 * 1024 * 1024 }
    );

    const lines = stdout.trim().split('\n').filter(Boolean);
    const commits: GitCommitInfo[] = lines.map(line => {
      const [hash, author, date, ...messageParts] = line.split('|');
      const message = messageParts.join('|'); // Handle pipes in commit message

      return {
        hash,
        shortHash: hash.substring(0, 7),
        author,
        date,
        message,
      };
    });

    const duration = Date.now() - startTime;
    logger.debug('file-browser', `Got git log (${duration}ms)`, { directory, filepath });

    return commits;
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    logger.error('file-browser', `Failed to get git log (${duration}ms)`, { directory, filepath }, { error: err.message });
    throw new Error(`Failed to get git log: ${err.message}`);
  }
}
