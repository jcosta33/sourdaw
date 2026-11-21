import { type MetricGoalEvaluation } from '../models/MetricGoalAdmission';

import { OBJECTIVE_METRIC_LABELS } from './objectiveMetricProjection';
import { readVerdictFigures } from './readVerdictFigures';

type Criterion = MetricGoalEvaluation['criteria'][number];

/** The pair of figures that broke a hold: one target's reading before and after the step or the whole batch. */
export type HoldViolation = { targetId: string; from: number; to: number };

function readMetricLabel(metricId: string | null): string {
    return Object.entries(OBJECTIVE_METRIC_LABELS).find(([id]) => id === metricId)?.[1] ?? 'a metric';
}

/**
 * The refusal the user sees for a recipe hold the preview broke: the metric, the target, the figures of
 * the comparison that failed, how far they moved and the versioned tolerance they were allowed.
 */
export function describeRecipeHoldFailure(
    criterion: Criterion,
    violation: HoldViolation,
    nameOf: (targetId: string) => string
): string {
    const unit = criterion.unit === 'hertz' ? 'Hz' : (criterion.unit ?? '');
    const subject = `${readMetricLabel(criterion.metricId)}${criterion.band === null ? '' : ` (${criterion.band} band)`} on ${nameOf(violation.targetId)}`;
    const { from, to, movement } = readVerdictFigures({
        from: violation.from,
        to: violation.to,
        relation: 'hold',
        tolerance: criterion.tolerance,
        rounding: 'significant',
        start: 3,
    });
    return `The preview breaks the recipe's hold on ${subject}: it moved from ${String(from)} to ${String(to)} ${unit}, a movement of ${String(movement)} ${unit}, beyond its ${String(criterion.tolerance)} ${unit} tolerance.`;
}
