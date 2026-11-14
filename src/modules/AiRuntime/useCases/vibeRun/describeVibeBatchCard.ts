import { type AdoptedRecipe } from '../../models/AdoptedRecipe';
import { type MetricGoalEvaluation } from '../../models/MetricGoalAdmission';
import { type ProjectContext } from '../../models/ProjectContext';
import { type ScheduledVibeRunBatch, type VibeRunExpectedDelta } from '../../models/VibeRunPlan';

import { type VibeBatchValueChoice } from './chooseVibeBatchValues';
import { describeCatalogueDefaultsReason } from './describeCatalogueDefaultsReason';
import { describeRecipeValueSource } from './describeRecipeValueSource';
import { describeVibeRunObjective } from './describeVibeRunObjective';
import { formatVibeFigure } from './formatVibeFigure';
import { readVibeMetricLabel } from './readVibeMetricLabel';
import { readVibeTargetName } from './readVibeTargetName';

type Criterion = MetricGoalEvaluation['criteria'][number];

const DIRECTION_WORDS: Readonly<Record<VibeRunExpectedDelta['direction'], string>> = {
    increase: 'rises',
    decrease: 'falls',
    hold: 'holds',
};

/** A hold's versioned tolerance in its metric's unit, which a card line states because the figures alone cannot show it. */
function describeTolerance(criterion: Criterion): string {
    const { unit } = criterion;
    if (unit === null || unit === 'ratio' || unit === 'count' || unit === 'correlation') {
        return String(criterion.tolerance);
    }
    return `${String(criterion.tolerance)} ${unit === 'hertz' ? 'Hz' : unit}`;
}

/**
 * The card lines of one planned batch: its objective, what its recipes promise on each target, and
 * each recipe criterion's measured baseline and preview figures as the preview read them.
 */
export function describeVibeBatchCard(input: {
    batch: ScheduledVibeRunBatch;
    context: Pick<ProjectContext, 'tracks'>;
    criteria: readonly Criterion[];
    adoptedRecipes: readonly AdoptedRecipe[];
    valueChoice: VibeBatchValueChoice;
}): string[] {
    const lines = [`Objective: ${describeVibeRunObjective(input.batch)}.`];
    for (const recipe of input.adoptedRecipes) {
        const source = describeRecipeValueSource(recipe);
        const line = `Recipe: ${recipe.title} on ${readVibeTargetName(input.context, recipe.targetId)}`;
        lines.push(source === null ? `${line}.` : `${line} — ${source}.`);
    }
    if (input.valueChoice.source === 'catalogue-defaults') {
        lines.push(describeCatalogueDefaultsReason(input.valueChoice.reason, input.valueChoice.detail));
    }
    for (const target of input.batch.targets) {
        const expected = target.expectedDeltas
            .map((delta) => `${readVibeMetricLabel(delta.metric, delta.band)} ${DIRECTION_WORDS[delta.direction]}`)
            .join('; ');
        lines.push(`Expected on ${readVibeTargetName(input.context, target.targetId)}: ${expected}.`);
    }
    for (const criterion of input.criteria) {
        if (criterion.source.kind !== 'recipe') {
            continue;
        }
        const target = criterion.targetIds.map((id) => readVibeTargetName(input.context, id)).join(', ');
        const held = criterion.relation === 'hold' ? ` held within ${describeTolerance(criterion)}` : '';
        lines.push(
            `Fresh approval preview on ${target}, ${criterion.range?.sectionId ?? 'arrangement'} [${String(criterion.range?.startBeat)}, ${String(criterion.range?.endBeat)}]: ${readVibeMetricLabel(criterion.metricId, criterion.band)}${held} ${formatVibeFigure(criterion.baseline[0], criterion.unit)} → ${formatVibeFigure(criterion.observed[0], criterion.unit)} (${criterion.status}).`
        );
    }
    return lines;
}
