/**
 * Adapter for the opencode CLI.
 */
export const command = 'opencode';

/**
 * Build the final args array for launching opencode.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @param {object} options      - taskFile, branch, worktreePath
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = [], options = {}) {
    return [...extraArgs];
}
