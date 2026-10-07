export type ActiveAgentRunsCanceller = () => void;

/**
 * The registered canceller of the agent runs still in flight, held between the
 * registration use case and `resetModuleStoresToDefault` so each file exports
 * exactly one function. `current` is null until the composition root registers
 * an implementation; see `setActiveAgentRunsCanceller` and `src/app/bootstrap.ts`.
 *
 * The seam exists because the canceller lives in AiRuntime and importing its
 * barrel from Project is a module cycle — AiRuntime's planning imports Project's
 * own use cases.
 */
export const activeAgentRunsCancellerRef: { current: ActiveAgentRunsCanceller | null } = {
    current: null,
};
