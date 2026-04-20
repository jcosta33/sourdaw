/**
 * Adapter for the Gemini CLI.
 */
export const command = 'gemini';

/**
 * Build the final args array for launching Gemini.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @param {object} options      - taskFile, branch, worktreePath (unused — context via CLAUDE.md)
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = [], options = {}) {
    // Gemini CLI does not support session naming yet.
    // Session context is provided via .agents/tasks/ which CLAUDE.md instructs the agent to read.
    return [...extraArgs];
}
