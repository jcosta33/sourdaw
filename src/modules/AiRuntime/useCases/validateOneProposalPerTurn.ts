import { COMMAND_BATCH_PROPOSAL_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ToolCallResult } from '../transformers/toolCallParser';

/**
 * One turn proposes one batch. Two proposals leave no answer to which one the run made, and the
 * compiler downstream reads a single proposal — so a second one would slip past the budget and the
 * target rules that only ever examine the first. Refusing here says so in a reason the model sees.
 */
export function validateOneProposalPerTurn(calls: readonly { call: ToolCallResult }[]): string | null {
    const proposalCount = calls.filter(({ call }) => call.name === COMMAND_BATCH_PROPOSAL_TOOL_NAME).length;
    return proposalCount > 1 ? 'Provider returned more than one command batch proposal in one turn.' : null;
}
