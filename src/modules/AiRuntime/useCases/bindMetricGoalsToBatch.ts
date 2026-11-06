import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { digestCommandBatchContent } from './digestCommandBatchContent';
import { type MetricGoalState } from './metricGoalContractTypes';
import { readNativeLiteralCommandBinding } from './readNativeLiteralCommandBinding';

/** Rebinding never deletes intent. A changed/subset batch must earn fresh compatible proof. */
export function bindMetricGoalsToBatch(input: {
    state: MetricGoalState | null | undefined;
    commandBatch: { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };
    schedulePosition?: number;
}): MetricGoalState {
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new TypeError(parsed.reason);
    }
    const envelope = parsed.envelope;
    const original = input.state ?? { schemaVersion: 1, authorities: [], steps: [], proofs: [], binding: null };
    const schedulePosition = input.schedulePosition ?? original.binding?.schedulePosition ?? null;
    const advancesSchedule = original.binding !== null && original.binding.schedulePosition !== schedulePosition;
    const prefixes: NonNullable<MetricGoalState['binding']>['prefixes'][number][] = [];
    let offset = 0;
    let before: string | null = null;
    let complete = original.steps.length > 0;
    for (const step of original.steps) {
        const slice = envelope.commands.slice(offset, offset + step.commandCount);
        if (
            (step.stepId !== 'overall' && step.recipePrefixHash === null) ||
            slice.length !== step.commandCount ||
            slice.some((command, index) => command.operation !== step.operationTypes[index])
        ) {
            complete = false;
            break;
        }
        offset += step.commandCount;
        const commands = envelope.commands.slice(0, offset);
        const ids = new Set(commands.map((command) => command.commandId));
        const after = digestCommandBatchContent({
            ...envelope,
            commands,
            batchLocalBindings: envelope.batchLocalBindings.filter((binding) => ids.has(binding.producerCommandId)),
        });
        if (step.recipePrefixHash !== null && step.recipePrefixHash !== after) {
            complete = false;
            break;
        }
        prefixes.push({ stepId: step.stepId, before, after });
        before = after;
    }
    if (offset !== envelope.commands.length || !complete) {
        prefixes.length = 0;
    }
    return {
        ...structuredClone(original),
        nativeLiteralUses: original.nativeLiteralUses?.map((use) => ({
            ...structuredClone(use),
            binding: use.binding ?? readNativeLiteralCommandBinding(use, envelope, schedulePosition),
        })),
        proofs: advancesSchedule ? [] : structuredClone(original.proofs),
        binding: {
            contentHash: digestCommandBatchContent(envelope),
            revision: envelope.baseRevision,
            projectId: envelope.projectId,
            runId: envelope.runId,
            batchId: envelope.batchId,
            schedulePosition,
            prefixes,
        },
    };
}
