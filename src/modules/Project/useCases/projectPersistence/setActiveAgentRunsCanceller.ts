import { activeAgentRunsCancellerRef, type ActiveAgentRunsCanceller } from './helpers/activeAgentRunCancellationState';

/**
 * Register the function that cancels the agent runs still in flight. See
 * `activeAgentRunCancellationState.ts` for why this seam exists instead of a
 * direct cross-module import.
 */
export function setActiveAgentRunsCanceller(next: ActiveAgentRunsCanceller): void {
    activeAgentRunsCancellerRef.current = next;
}
