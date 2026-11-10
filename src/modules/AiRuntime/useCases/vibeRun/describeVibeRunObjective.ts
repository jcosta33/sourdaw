import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';

/** What one batch is for: the characters it pursues, on the role family it serves. */
export function describeVibeRunObjective(batch: Pick<ScheduledVibeRunBatch, 'objective'>): string {
    return `${batch.objective.descriptors.join(' and ')} ${batch.objective.role}`;
}
