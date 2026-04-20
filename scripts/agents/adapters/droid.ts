/**
 * Adapter for the Factory Droid CLI.
 */
export const command = 'droid';

/**
 * Build the final args array for launching Droid.
 * @param {string} slug
 * @param {string[]} extraArgs  - from --agent-args
 * @param {object} options      - taskFile, branch, worktreePath (unused — context via repo instructions)
 * @returns {string[]}
 */
export function buildArgs(slug, extraArgs = [], options = {}) {
    // Droid supports inline prompts and session resume flags, but this launcher
    // relies on the repo instructions and task file inside the worktree for context.
    return [...extraArgs];
}
