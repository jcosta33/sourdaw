/**
 * Adapter for the Gemini CLI.
 */
export const command = 'gemini';
export const defaultArgs = [];

/**
 * Build the final args array for launching Gemini.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = []) {
  // Gemini CLI passthrough — no session naming built-in yet
  return [...defaultArgs, ...extraArgs];
}
