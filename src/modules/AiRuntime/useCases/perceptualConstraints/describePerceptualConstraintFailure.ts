import { type MetricGoalEvaluation } from '../../models/MetricGoalAdmission';
import { OBJECTIVE_METRIC_LABELS, OBJECTIVE_METRIC_UNITS } from '../objectiveMetricProjection';

type Criterion = MetricGoalEvaluation['criteria'][number];
type Failure = NonNullable<MetricGoalEvaluation['failure']>;

function figure(value: number | undefined): string {
    return value === undefined ? 'unavailable' : String(Math.round(value * 1000) / 1000);
}

/** The refusal the user sees for a constraint goal: the clause, and for a measured one the metric and figures. */
export function describePerceptualConstraintFailure(
    criterion: Criterion,
    failure: Failure,
    nameOf: (targetId: string) => string
): string {
    if (criterion.source.kind !== 'constraint') {
        throw new TypeError('Only a constraint criterion has a constraint failure.');
    }
    const clause = criterion.source.clause;
    if (criterion.metricId === null || criterion.source.constraintId === 'unsupported') {
        return `The request says “${clause}”, and no measurement the application takes can show that it holds, so this batch cannot be approved. State it as a protected track or control instead.`;
    }
    const metricId = criterion.metricId;
    const metric = Object.entries(OBJECTIVE_METRIC_LABELS).find(([id]) => id === metricId)?.[1] ?? metricId;
    const unit = Object.entries(OBJECTIVE_METRIC_UNITS).find(([id]) => id === metricId)?.[1] ?? '';
    const subject = `${metric}${criterion.band === null ? '' : ` (${criterion.band} band)`} on ${criterion.targetIds.map(nameOf).join(', ')}`;
    if (failure === 'out-of-tolerance') {
        return `The preview breaks “${clause}”: ${subject} moved from ${figure(criterion.baseline[0])} to ${figure(criterion.observed[0])} ${unit}, beyond its ${String(criterion.tolerance)} ${unit} tolerance.`;
    }
    return `“${clause}” is unverified: no compatible baseline and preview measurement of ${subject} exists for this batch. Re-preview to measure it.`;
}
