import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { basename, resolve } from 'path';

/**
 * Run a git command and return stdout as string.
 * @param {string[]} args
 * @param {object} opts  - optional cwd
 * @returns {string}
 */
function git(args, opts = {}) {
  const result = spawnSync('git', args, {
    cwd: opts.cwd,
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`git error: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || `git ${args[0]} failed`);
  }
  return (result.stdout || '').trim();
}

/**
 * Find the root of the current git repository.
 * @returns {string}
 */
export function getRepoRoot() {
  try {
    return git(['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error('Not inside a git repository. Run this command from within the repo.');
  }
}

/**
 * Get the repo directory name (used for worktree path patterns).
 * @param {string} repoRoot
 * @returns {string}
 */
export function getRepoName(repoRoot) {
  return basename(repoRoot);
}

/**
 * Parse `git worktree list --porcelain` output into an array of objects.
 * @param {string} repoRoot
 * @returns {Array<{path: string, head: string, branch: string, bare: boolean}>}
 */
export function worktreeList(repoRoot) {
  let raw;
  try {
    raw = git(['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  } catch {
    return [];
  }
  const worktrees = [];
  let current = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice(9), head: null, branch: null, bare: false };
    } else if (line.startsWith('HEAD ') && current) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === 'bare' && current) {
      current.bare = true;
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

/**
 * Check if a local branch exists.
 * @param {string} branch
 * @param {string} repoRoot
 * @returns {boolean}
 */
export function branchExists(branch, repoRoot) {
  const result = spawnSync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0;
}

/**
 * Find which worktree (if any) has a given branch checked out.
 * @param {string} branch
 * @param {string} repoRoot
 * @returns {string|null} - worktree path, or null
 */
export function findWorktreeForBranch(branch, repoRoot) {
  const list = worktreeList(repoRoot);
  const found = list.find(w => w.branch === branch);
  return found ? found.path : null;
}

/**
 * Create a new worktree. If branch doesn't exist, creates it from baseBranch.
 * @param {string} worktreePath  - absolute path
 * @param {string} branch
 * @param {string} baseBranch
 * @param {string} repoRoot
 */
export function worktreeCreate(worktreePath, branch, baseBranch, repoRoot) {
  const exists = branchExists(branch, repoRoot);
  if (exists) {
    git(['worktree', 'add', worktreePath, branch], { cwd: repoRoot });
  } else {
    git(['worktree', 'add', '-b', branch, worktreePath, baseBranch], { cwd: repoRoot });
  }
}

/**
 * Remove a worktree. Uses --force if requested.
 * @param {string} worktreePath
 * @param {boolean} force
 * @param {string} repoRoot
 */
export function worktreeRemove(worktreePath, force, repoRoot) {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);
  git(args, { cwd: repoRoot });
}

/**
 * Run `git worktree prune`.
 * @param {string} repoRoot
 */
export function worktreePrune(repoRoot) {
  git(['worktree', 'prune'], { cwd: repoRoot });
}

/**
 * Check if a worktree has uncommitted changes.
 * @param {string} worktreePath - absolute path to worktree
 * @returns {boolean}
 */
export function isWorktreeDirty(worktreePath) {
  if (!existsSync(worktreePath)) return false;
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    encoding: 'utf8',
  });
  if (result.status !== 0) return false;
  return (result.stdout || '').trim().length > 0;
}

/**
 * Get a short git status summary for a worktree.
 * @param {string} worktreePath
 * @returns {string}
 */
export function getStatusSummary(worktreePath) {
  if (!existsSync(worktreePath)) return 'missing';
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    encoding: 'utf8',
  });
  if (result.status !== 0) return 'unknown';
  const lines = (result.stdout || '').trim();
  if (!lines) return 'clean';
  const count = lines.split('\n').length;
  return `dirty (${count} change${count !== 1 ? 's' : ''})`;
}

/**
 * Check that git is available.
 * @returns {boolean}
 */
export function gitAvailable() {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}
