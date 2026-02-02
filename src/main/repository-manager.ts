/**
 * Repository Manager - Track unique repositories across all agents
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { getConfigDir, writeConfigAtomic } from './config';
import {
  isGitRepo,
  getMainRepoRoot,
  getRepoRoot,
  getDefaultBranch,
  getRemoteUrl,
  isWorktree,
} from './git-utils';
import type { Repository } from '../shared/types';

// In-memory cache of repositories
let repositoriesCache: Repository[] | null = null;

/**
 * Get the path to the repositories config file
 */
function getRepositoriesPath(): string {
  return path.join(getConfigDir(), 'repositories.json');
}

/**
 * Generate a unique repository ID from its root path
 */
function generateRepoId(rootPath: string): string {
  return crypto.createHash('md5').update(rootPath).digest('hex').substring(0, 12);
}

/**
 * Load repositories from disk
 */
export async function loadRepositories(): Promise<Repository[]> {
  if (repositoriesCache !== null) {
    return repositoriesCache;
  }

  const reposPath = getRepositoriesPath();

  try {
    const data = await fs.readFile(reposPath, 'utf-8');
    repositoriesCache = JSON.parse(data);
    return repositoriesCache!;
  } catch (error) {
    // File doesn't exist or is invalid
    repositoriesCache = [];
    return [];
  }
}

/**
 * Save repositories to disk
 */
async function saveRepositories(repositories: Repository[]): Promise<void> {
  repositoriesCache = repositories;
  const reposPath = getRepositoriesPath();
  await writeConfigAtomic(reposPath, JSON.stringify(repositories, null, 2));
}

/**
 * Detect and register a repository from a directory
 * Returns the repository if detected, null if not a git repo
 */
export async function detectRepository(
  directory: string
): Promise<Repository | null> {
  // Check if this is a git repo
  if (!(await isGitRepo(directory))) {
    return null;
  }

  // Get the root of the repository (handles worktrees)
  let rootPath: string | null;

  if (await isWorktree(directory)) {
    // If it's a worktree, get the main repo root
    rootPath = await getMainRepoRoot(directory);
  } else {
    // Otherwise get the normal repo root
    rootPath = await getRepoRoot(directory);
  }

  if (!rootPath) {
    return null;
  }

  // Check if we already have this repository registered
  const repositories = await loadRepositories();
  const existingRepo = repositories.find((r) => r.rootPath === rootPath);

  if (existingRepo) {
    return existingRepo;
  }

  // Create new repository entry
  const newRepo: Repository = {
    id: generateRepoId(rootPath),
    rootPath,
    name: path.basename(rootPath),
    defaultBranch: await getDefaultBranch(rootPath),
    remoteUrl: (await getRemoteUrl(rootPath)) || undefined,
  };

  // Save the new repository
  repositories.push(newRepo);
  await saveRepositories(repositories);

  return newRepo;
}

/**
 * Get a repository by its ID
 */
export async function getRepositoryById(
  id: string
): Promise<Repository | undefined> {
  const repositories = await loadRepositories();
  return repositories.find((r) => r.id === id);
}

/**
 * Get a repository by its root path
 */
export async function getRepositoryByPath(
  rootPath: string
): Promise<Repository | undefined> {
  const repositories = await loadRepositories();
  return repositories.find((r) => r.rootPath === rootPath);
}

/**
 * Update a repository's configuration
 */
export async function updateRepository(
  id: string,
  updates: Partial<Pick<Repository, 'name' | 'purpose' | 'completionCriteria' | 'protectedBranches'>>
): Promise<Repository | undefined> {
  const repositories = await loadRepositories();
  const index = repositories.findIndex((r) => r.id === id);

  if (index === -1) {
    return undefined;
  }

  repositories[index] = {
    ...repositories[index],
    ...updates,
  };

  await saveRepositories(repositories);
  return repositories[index];
}

/**
 * Get all registered repositories
 */
export async function getAllRepositories(): Promise<Repository[]> {
  return loadRepositories();
}

/**
 * Get unique repositories from a list of agent directories
 */
export async function getUniqueRepositories(
  directories: string[]
): Promise<Repository[]> {
  const repositories = await loadRepositories();
  const repoIds = new Set<string>();
  const result: Repository[] = [];

  for (const dir of directories) {
    // Try to detect/get repository for this directory
    const repo = await detectRepository(dir);
    if (repo && !repoIds.has(repo.id)) {
      repoIds.add(repo.id);
      result.push(repo);
    }
  }

  return result;
}

/**
 * Remove a repository from the registry
 */
export async function removeRepository(id: string): Promise<boolean> {
  const repositories = await loadRepositories();
  const index = repositories.findIndex((r) => r.id === id);

  if (index === -1) {
    return false;
  }

  repositories.splice(index, 1);
  await saveRepositories(repositories);
  return true;
}

/**
 * Refresh repository info (default branch, remote URL)
 */
export async function refreshRepository(id: string): Promise<Repository | undefined> {
  const repositories = await loadRepositories();
  const repo = repositories.find((r) => r.id === id);

  if (!repo) {
    return undefined;
  }

  // Check if the repository still exists
  if (!(await isGitRepo(repo.rootPath))) {
    return repo; // Return as-is, caller can decide what to do
  }

  // Update dynamic info
  repo.defaultBranch = await getDefaultBranch(repo.rootPath);
  repo.remoteUrl = (await getRemoteUrl(repo.rootPath)) || undefined;

  await saveRepositories(repositories);
  return repo;
}

/**
 * Clear the repositories cache (useful for testing)
 */
export function clearRepositoriesCache(): void {
  repositoriesCache = null;
}
