/**
 * Adapter for the Kimi CLI.
 */
export const command = 'kimi';

/**
 * Build the final args array for launching Kimi.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @param {object} options      - taskFile, branch, worktreePath (unused — context via CLAUDE.md)
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = [], options = {}) {
    // Kimi does not support naming new sessions — sessions are associated with the working directory.
    // The -S flag is for resuming existing sessions, not naming new ones.
    // Session context is provided via .agents/tasks/ which CLAUDE.md instructs the agent to read.
    return [...extraArgs];
}
