import { type MetricGoalEvaluation } from '../models/MetricGoalAdmission';

import { OBJECTIVE_METRIC_LABELS } from './objectiveMetricProjection';

type Criterion = MetricGoalEvaluation['criteria'][number];

/** The pair of figures that broke a hold: one target's reading before and after the step or the whole batch. */
export type HoldViolation = { targetId: string; from: number; to: number };

/**
 * The fewest significant digits, three at least, at which the movement prints above the tolerance, so a
 * movement beyond it never prints as equal to it. The figures print at the same precision.
 */
function readPrecision(movement: number, tolerance: number): number {
    for (let digits = 3; digits < 17; digits += 1) {
        if (Number(movement.toPrecision(digits)) > tolerance) {
            return digits;
        }
    }
    return 17;
}

function figure(value: number, digits: number): string {
    return String(Number(value.toPrecision(digits)));
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
    const metricId = criterion.metricId;
    const metric = metricId === null ? 'a metric' : OBJECTIVE_METRIC_LABELS[metricId];
    const unit = criterion.unit === 'hertz' ? 'Hz' : (criterion.unit ?? '');
    const subject = `${metric}${criterion.band === null ? '' : ` (${criterion.band} band)`} on ${nameOf(violation.targetId)}`;
    const movement = Math.abs(violation.to - violation.from);
    const digits = readPrecision(movement, criterion.tolerance);
    return `The preview breaks the recipe's hold on ${subject}: it moved from ${figure(violation.from, digits)} to ${figure(violation.to, digits)} ${unit}, a movement of ${figure(movement, digits)} ${unit}, beyond its ${String(criterion.tolerance)} ${unit} tolerance.`;
}
