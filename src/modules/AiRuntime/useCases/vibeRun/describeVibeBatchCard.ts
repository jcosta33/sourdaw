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

const REQUIRED_MOVEMENT_WORDS: Readonly<Record<Criterion['relation'], string>> = {
    increase: 'expected to rise',
    decrease: 'expected to fall',
    hold: 'expected to hold',
    'no-increase': 'expected not to rise',
    'no-decrease': 'expected not to fall',
    'match-current': 'expected to match',
    'greater-than-current': 'expected to exceed its reference',
    'less-than-current': 'expected to stay under its reference',
    target: 'expected to reach its target',
    unsupported: 'unsupported',
};

/** A step that broke its criterion on figures other than the batch pair the line shows names its own pair. */
function describeOwnStep(criterion: Criterion): string {
    const { unmet } = criterion;
    if (unmet === null || unmet.scope !== 'step') {
        return '';
    }
    if (unmet.from === criterion.initial[0] && unmet.to === criterion.final[0]) {
        return '';
    }
    return `; within its own step it went ${formatVibeFigure(unmet.from, criterion.unit)} → ${formatVibeFigure(unmet.to, criterion.unit)}`;
}

/** What admission found for one criterion: the figures it compared and whether they met the criterion. */
function describeCriterionFigures(criterion: Criterion): string {
    if (criterion.outcome === 'not-reached') {
        return 'not evaluated (blocked)';
    }
    if (criterion.outcome === 'not-evaluated') {
        return 'not evaluated: admission read no compatible baseline and preview figures for it (blocked)';
    }
    const figures = `${formatVibeFigure(criterion.initial[0], criterion.unit)} → ${formatVibeFigure(criterion.final[0], criterion.unit)}`;
    if (criterion.outcome === 'met') {
        return `${figures} (${criterion.status})`;
    }
    return `${figures} (blocked): not met, ${REQUIRED_MOVEMENT_WORDS[criterion.relation]}${describeOwnStep(criterion)}`;
}

/**
 * The card lines of one planned batch: its objective, what its recipes promise on each target, and
 * each recipe criterion's initial baseline and final previewed figures, the pair admission judged it across.
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
            `Fresh approval preview on ${target}, ${criterion.range?.sectionId ?? 'arrangement'} [${String(criterion.range?.startBeat)}, ${String(criterion.range?.endBeat)}]: ${readVibeMetricLabel(criterion.metricId, criterion.band)}${held} ${describeCriterionFigures(criterion)}.`
        );
    }
    return lines;
}
