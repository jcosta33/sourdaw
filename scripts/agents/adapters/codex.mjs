/**
 * Adapter for the OpenAI Codex CLI.
 */
export const command = 'codex';

/**
 * Build the final args array for launching Codex.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @param {object} options      - taskFile, branch, worktreePath (unused — context via CLAUDE.md)
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = [], options = {}) {
  // Codex does not support session naming. Pass sandbox/profile args via --agent-args.
  // Session context is provided via .agents/tasks/ which CLAUDE.md instructs the agent to read.
  return [...extraArgs];
}
