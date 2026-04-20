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
    //
    // --full-auto: sandbox=workspace-write, approval=on-request. Best available
    // baseline — Codex has no per-command allow/deny list, so bulk-modification
    // patterns (sed -i, perl -i, find -exec, codemods, xargs pipelines) cannot
    // be blocked declaratively the way they are for Claude/Gemini. The sandbox
    // limits writes to the workspace; denial of specific edit patterns must be
    // enforced via the agent's CLAUDE.md / AGENTS.md instructions.
    const args = ['--full-auto'];
    return [...args, ...extraArgs];
}
