import { type AdoptedRecipe } from '../../models/AdoptedRecipe';
import { type VibeBatchValueSource } from '../../models/VibeBatchValueSource';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';

import { describeVibeBatchCard } from './describeVibeBatchCard';

/**
 * The card text of one planned vibe batch: the batch description, then its objective, recipe,
 * value-source, expected and figure lines, each figure read from `state`'s own proofs of
 * `commandBatch`. A first proposal and a re-preview both compose the card here, so a re-previewed
 * card says what a freshly proposed one would.
 */
export function composeVibeBatchCardContent(input: {
    descriptionContent: string;
    batch: ScheduledVibeRunBatch;
    context: Parameters<typeof describeVibeBatchCard>[0]['context'];
    state: Parameters<typeof evaluateMetricGoalAdmission>[0]['state'];
    commandBatch: Parameters<typeof evaluateMetricGoalAdmission>[0]['commandBatch'];
    adoptedRecipes: readonly AdoptedRecipe[];
    valueSource: VibeBatchValueSource;
}): string {
    const evaluation = evaluateMetricGoalAdmission({ state: input.state, commandBatch: input.commandBatch });
    const cardLines = describeVibeBatchCard({
        batch: input.batch,
        context: input.context,
        criteria: evaluation.criteria,
        adoptedRecipes: input.adoptedRecipes,
        // The card reads only where the values came from; the chosen values themselves ride the batch.
        valueChoice:
            input.valueSource.source === 'measurements' ? { source: 'measurements', pairs: [] } : input.valueSource,
    });
    return [input.descriptionContent, ...cardLines].join('\n');
}
