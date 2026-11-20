import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type BriefReadingPlan } from '../../models/BriefReading';
import { type VibeRunExpectedDelta } from '../../models/VibeRunPlan';

import { describeVibeRunObjective } from './describeVibeRunObjective';
import { readVibeMetricLabel } from './readVibeMetricLabel';

/** The brief holds the first position of its run; every planned batch follows it. */
const BRIEF_POSITION = 1;

const DIRECTION_WORDS: Readonly<Record<VibeRunExpectedDelta['direction'], string>> = {
    increase: 'up',
    decrease: 'down',
    hold: 'held',
};

function describeExpectedDeltas(deltas: readonly VibeRunExpectedDelta[]): string {
    const phrases = deltas.map(
        (delta) => `${readVibeMetricLabel(delta.metric, delta.band)} ${DIRECTION_WORDS[delta.direction]}`
    );
    return [...new Set(phrases)].join(', ');
}

/**
 * What choosing a reading would run, as card lines: each batch with its objective, and under it each
 * track with the recipes applied to it and the metric changes they promise. Recipe titles come from
 * the live catalogue, an id the catalogue no longer publishes standing for itself.
 */
export function describeBriefReadingPlan(plan: BriefReadingPlan): string[] {
    const recipes = getMixRecipeCatalog().recipes;
    const total = plan.batches.length + BRIEF_POSITION;
    return plan.batches.flatMap((batch) => [
        `Batch ${String(batch.ordinal + BRIEF_POSITION)} of ${String(total)}: ${describeVibeRunObjective(batch)}`,
        ...batch.targets.map((target) => {
            const name = plan.trackNames[target.targetId] ?? target.targetId;
            const titles = target.recipeIds.map((id) => recipes.find((recipe) => recipe.id === id)?.title ?? id);
            return `${name}: ${titles.join(', ')}. Expected: ${describeExpectedDeltas(target.expectedDeltas)}.`;
        }),
    ]);
}
