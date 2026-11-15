import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { normalizeAgentPlanProposal } from '../transformers/normalizeAgentPlanProposal';
import { type ToolCallResult } from '../transformers/toolCallParser';

import {
    ANALYSIS_REQUEST_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    RENDER_REQUEST_TOOL_NAME,
} from './agentToolCatalog';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expandCatalogProposals(calls: readonly ToolCallResult[]) {
    const proposals = calls.filter((call) => call.name === COMMAND_BATCH_PROPOSAL_TOOL_NAME);
    if (proposals.length > 1) {
        return { status: 'invalid' as const, reason: 'Provider proposed more than one command batch.' };
    }
    const proposal = proposals[0];
    const expandedByCall = new Map<ToolCallResult, ToolCallResult[]>();
    if (proposal) {
        if (
            Object.keys(proposal.arguments).some((key) => key !== 'commands' && key !== 'plan') ||
            !Array.isArray(proposal.arguments.commands) ||
            (proposal.arguments.plan !== undefined && normalizeAgentPlanProposal(proposal.arguments.plan) === null)
        ) {
            return {
                status: 'invalid' as const,
                reason: 'Provider command batch proposal does not match the strict catalog contract.',
            };
        }
        const commands = proposal.arguments.commands;
        if (commands.length === 0 || commands.length > MAX_LLM_ACTIONS_PER_BATCH) {
            return {
                status: 'invalid' as const,
                reason: 'Provider command batch proposal exceeds the command budget.',
            };
        }
        const expandedCommands: ToolCallResult[] = [];
        for (const command of commands) {
            if (!isRecord(command) || Object.keys(command).some((key) => key !== 'name' && key !== 'arguments')) {
                return {
                    status: 'invalid' as const,
                    reason: 'Provider command batch proposal has an invalid command shape.',
                };
            }
            if (
                typeof command.name !== 'string' ||
                command.name.length === 0 ||
                command.name.length > 128 ||
                !isRecord(command.arguments)
            ) {
                return {
                    status: 'invalid' as const,
                    reason: 'Provider command batch proposal has an invalid command.',
                };
            }
            expandedCommands.push({ name: command.name, arguments: command.arguments });
        }
        expandedByCall.set(proposal, expandedCommands);
    }
    for (const proposalCall of calls) {
        if (proposalCall.name === RENDER_REQUEST_TOOL_NAME) {
            const sectionIds = proposalCall.arguments.sectionIds;
            if (
                Object.keys(proposalCall.arguments).length !== 1 ||
                !Array.isArray(sectionIds) ||
                sectionIds.length === 0 ||
                sectionIds.length > 32 ||
                sectionIds.some(
                    (sectionId) => typeof sectionId !== 'string' || sectionId.length === 0 || sectionId.length > 256
                )
            ) {
                return {
                    status: 'invalid' as const,
                    reason: 'Provider render request does not match the strict catalog contract.',
                };
            }
            expandedByCall.set(proposalCall, [{ name: 'renderProjectSections', arguments: { sectionIds } }]);
            continue;
        }
        if (proposalCall.name !== ANALYSIS_REQUEST_TOOL_NAME) {
            continue;
        }
        if (Object.keys(proposalCall.arguments).length !== 1 || proposalCall.arguments.scope !== 'mix') {
            return {
                status: 'invalid' as const,
                reason: 'Provider analysis request does not match the strict catalog contract.',
            };
        }
        expandedByCall.set(proposalCall, [{ name: 'analyzeMix', arguments: {} }]);
    }
    return {
        status: 'valid' as const,
        calls: calls.flatMap((call) => expandedByCall.get(call) ?? [call]),
    };
}
