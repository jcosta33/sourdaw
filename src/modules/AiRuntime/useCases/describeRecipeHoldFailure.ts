import { type MetricGoalEvaluation } from '../models/MetricGoalAdmission';

import { OBJECTIVE_METRIC_LABELS } from './objectiveMetricProjection';

type Criterion = MetricGoalEvaluation['criteria'][number];

/** The pair of figures that broke a hold: one target's reading before and after the step or the whole batch. */
export type HoldViolation = { targetId: string; from: number; to: number };

function rounded(value: number, digits: number): number {
    return Number(value.toPrecision(digits));
}

/**
 * The fewest significant digits, three at least, at which the printed movement is above the tolerance and
 * the printed endpoints differ by that printed movement, so the sentence never reads as within tolerance.
 */
function readPrecision(violation: HoldViolation, tolerance: number): number {
    for (let digits = 3; digits < 17; digits += 1) {
        const movement = rounded(Math.abs(violation.to - violation.from), digits);
        const printedMovement = rounded(
            Math.abs(rounded(violation.to, digits) - rounded(violation.from, digits)),
            digits
        );
        if (movement > tolerance && printedMovement === movement) {
            return digits;
        }
    }
    return 17;
}

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
    const digits = readPrecision(violation, criterion.tolerance);
    const from = String(rounded(violation.from, digits));
    const to = String(rounded(violation.to, digits));
    const movement = String(rounded(Math.abs(violation.to - violation.from), digits));
    return `The preview breaks the recipe's hold on ${subject}: it moved from ${from} to ${to} ${unit}, a movement of ${movement} ${unit}, beyond its ${String(criterion.tolerance)} ${unit} tolerance.`;
}
