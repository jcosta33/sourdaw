import { type AppAction } from '#/utils/handlerContract';

import { COMMAND_BATCH_PROPOSAL_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type CreativeRequestMode } from '../models/CreativeInterpretation';
import { type RetainedCompilation } from '../models/RetainedCompilation';
import { type ToolCallResult } from '../transformers/toolCallParser';

type BriefAction = Extract<AppAction, { type: 'setProductionBrief' }>;

type BriefProposalAdmission = { status: 'admitted'; action: BriefAction } | { status: 'refused'; reason: string };

const PROPOSE_ALONE =
    'a brief request is answered by proposing the brief.compile callId alone in compiledCallIds, with an empty commands list and nothing beside it.';

function isEmptyCommandList(value: unknown): boolean {
    return Array.isArray(value) && value.length === 0;
}

/**
 * The brief a request may write, read from what the run admitted and proposed. A brief request and a
 * brief compilation must come together and alone: the brief interpretation, one proposal adopting
 * exactly one brief compilation, no command, list, refinement or other terminal beside it. Anything
 * else is a correctable refusal, so the provider can propose the brief alone or plan the edit.
 */
export function admitBriefProposal(input: {
    authorityMode: Exclude<CreativeRequestMode, 'unresolved'> | undefined;
    terminalCalls: readonly ToolCallResult[];
    selectedCompilations: readonly RetainedCompilation[];
    refines: boolean;
}): BriefProposalAdmission {
    const [proposal, ...others] = input.terminalCalls;
    const [compiled, ...otherCompilations] = input.selectedCompilations;
    if (
        input.authorityMode !== 'brief' ||
        input.refines ||
        proposal?.name !== COMMAND_BATCH_PROPOSAL_TOOL_NAME ||
        others.length > 0 ||
        !isEmptyCommandList(proposal.arguments.commands) ||
        (proposal.arguments.list !== undefined && proposal.arguments.list !== null) ||
        compiled?.kind !== 'brief' ||
        otherCompilations.length > 0
    ) {
        return { status: 'refused', reason: PROPOSE_ALONE };
    }
    const [command, ...otherCommands] = compiled.commands;
    const expectedRevision = command?.arguments.expectedRevision;
    if (
        command?.operation !== 'setProductionBrief' ||
        otherCommands.length > 0 ||
        typeof expectedRevision !== 'number'
    ) {
        return { status: 'refused', reason: PROPOSE_ALONE };
    }
    return {
        status: 'admitted',
        action: {
            type: 'setProductionBrief',
            payload: { expectedRevision, brief: structuredClone(command.arguments.brief) },
        },
    };
}
