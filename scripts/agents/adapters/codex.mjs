/**
 * Adapter for the OpenAI Codex CLI.
 */
export const command = 'codex';
export const defaultArgs = [];

/**
 * Build the final args array for launching Codex.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = []) {
  // Codex supports passthrough of profile/sandbox args via extraArgs
  return [...defaultArgs, ...extraArgs];
}
