/**
 * Adapter for the Claude CLI.
 */
export const command = 'claude';

/**
 * Build the final args array for launching Claude.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @param {object} options      - taskFile, branch, worktreePath (unused — context via CLAUDE.md)
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = [], options = {}) {
  const args = [];
  if (slug) args.push('--name', slug);
  // Session context is provided via .agents/tasks/ which CLAUDE.md instructs Claude to read.
  // --append-system-prompt is not used: it only works with --print (non-interactive mode).
  return [...args, ...extraArgs];
}
