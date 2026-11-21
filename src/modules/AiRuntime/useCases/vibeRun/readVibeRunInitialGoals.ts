import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type ScheduledVibeRunBatch, type VibeRunVerificationRange } from '../../models/VibeRunPlan';
import { type MetricGoal } from '../metricGoalContractTypes';

import { readVibeBatchRecipeGoals } from './readVibeBatchRecipeGoals';

/** The goals every batch's recipes state over the arrangement, or the first batch's refusal. */
export function readVibeRunInitialGoals(
    batches: readonly ScheduledVibeRunBatch[],
    catalog: ReturnType<typeof getMixRecipeCatalog>,
    range: VibeRunVerificationRange
) {
    const goals: MetricGoal[] = [];
    for (const batch of batches) {
        const read = readVibeBatchRecipeGoals({ batch, catalog, range });
        if (read.status === 'refused') {
            return read;
        }
        goals.push(...read.goals);
    }
    return { status: 'read' as const, goals };
}
