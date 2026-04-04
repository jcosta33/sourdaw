/**
 * Adapter for the Claude CLI.
 */
export const command = 'claude';
export const defaultArgs = [];

/**
 * Build the final args array for launching Claude.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = []) {
  const args = [];
  if (slug) args.push('--name', slug);
  return [...args, ...extraArgs];
}
