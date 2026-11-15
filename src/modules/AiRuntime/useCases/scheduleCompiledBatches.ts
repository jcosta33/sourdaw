import { type IntentResult } from '../models/IntentResult';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type RetainedCompilation } from '../models/RetainedCompilation';

import { COMMAND_BATCH_PROPOSAL_TOOL_NAME } from './agentToolCatalog';
import { type ArbitraryCommandListCompilation } from './compileArbitraryCommandList';
import { splitCompiledCommandList } from './splitCompiledCommandList';

type AcceptedCompiledList = Extract<ArbitraryCommandListCompilation, { status: 'accepted' }>;

type ScheduledCompiledBatches =
    | { status: 'scheduled'; firstBatch: AcceptedCompiledList; batchSchedule?: IntentResult['batchSchedule'] }
    | { status: 'rejected'; reason: string };

/**
 * A list that expands past one batch runs as successive batches, each approved on its own. This
 * planning turn carries the first; the rest are kept serialized on the result until the run proposes
 * them. A list that fits one batch passes through untouched. Only a plain structured list can be
 * split: an adopted transform, recipe or measured preview, or a specialized workflow or other request
 * beside the list, describes one batch and is refused rather than cut apart.
 */
export function scheduleCompiledBatches(input: {
    compiledList: AcceptedCompiledList;
    selectedCompilations: readonly RetainedCompilation[];
    providerProposal: IntentResult['providerProposal'] | null;
}): ScheduledCompiledBatches {
    const evidence = input.compiledList.compilerEvidence;
    if (evidence === undefined || evidence.commands.length <= MAX_LLM_ACTIONS_PER_BATCH) {
        return { status: 'scheduled', firstBatch: input.compiledList };
    }
    if (input.selectedCompilations.length > 0) {
        return {
            status: 'rejected',
            reason: 'An adopted transform, recipe or measured preview cannot run as successive batches.',
        };
    }
    if (input.compiledList.calls.some((call) => call.name !== COMMAND_BATCH_PROPOSAL_TOOL_NAME)) {
        return {
            status: 'rejected',
            reason: 'A list larger than one batch cannot share its turn with a specialized workflow or another request.',
        };
    }
    const split = splitCompiledCommandList({
        evidence,
        maxCommandsPerBatch: MAX_LLM_ACTIONS_PER_BATCH,
        setSelectors: input.compiledList.setSelectors,
    });
    if (split.status === 'rejected') {
        return split;
    }
    const first = split.slices[0]!;
    return {
        status: 'scheduled',
        firstBatch: {
            ...input.compiledList,
            compilerEvidence: first,
            calls: input.compiledList.calls.map((call) => ({
                name: call.name,
                arguments: { plan: call.arguments.plan, commands: structuredClone(first.commands) },
            })),
        },
        batchSchedule: {
            schemaVersion: 1,
            kind: 'bulk-set',
            scheduleId: `batch-schedule-${crypto.randomUUID()}`,
            position: 1,
            total: split.slices.length,
            totalCommands: evidence.commands.length,
            serializedProviderProposal:
                input.providerProposal === null || input.providerProposal === undefined
                    ? null
                    : JSON.stringify(input.providerProposal),
            slices: split.slices.map((slice, index) => ({
                position: index + 1,
                commandCount: slice.commands.length,
                targetIds: [...slice.providerKnownTargetIds],
                serializedSlice: JSON.stringify(slice),
            })),
        },
    };
}
