import path from 'path';

/**
 * Validate that a filepath doesn't contain path traversal
 */
export function validateFilepath(filepath: string): void {
  if (filepath.includes('..') || path.isAbsolute(filepath)) {
    throw new Error('Invalid filepath: path traversal not allowed');
  }
}
