import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { digestCommandBatchContent } from './digestCommandBatchContent';
import { type MetricGoalState } from './metricGoalContractTypes';

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
    const prefixes: NonNullable<MetricGoalState['binding']>['prefixes'][number][] = [];
    let offset = 0;
    let before: string | null = null;
    let complete = original.steps.length > 0;
    for (const step of original.steps) {
        const slice = envelope.commands.slice(offset, offset + step.commandCount);
        if (
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
        prefixes.push({ stepId: step.stepId, before, after });
        before = after;
    }
    if (offset !== envelope.commands.length || !complete) {
        prefixes.length = 0;
    }
    return {
        ...structuredClone(original),
        binding: {
            contentHash: digestCommandBatchContent(envelope),
            revision: envelope.baseRevision,
            projectId: envelope.projectId,
            runId: envelope.runId,
            batchId: envelope.batchId,
            schedulePosition: input.schedulePosition ?? null,
            prefixes,
        },
    };
}
