import { type ScheduledVibeRunBatch, type VibeRunPlan } from '../../models/VibeRunPlan';

export function toScheduledVibeRunBatch(batch: VibeRunPlan['batches'][number]): ScheduledVibeRunBatch {
    return {
        id: batch.id,
        ordinal: batch.ordinal,
        objective: structuredClone(batch.objective),
        targetIds: [...batch.targetIds],
        targets: structuredClone(batch.targets),
        commandCount: batch.commandCount,
    };
}
