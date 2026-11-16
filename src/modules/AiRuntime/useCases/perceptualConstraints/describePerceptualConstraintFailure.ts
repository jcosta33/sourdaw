import { type MetricGoalEvaluation } from '../../models/MetricGoalAdmission';
import { OBJECTIVE_METRIC_LABELS, OBJECTIVE_METRIC_UNITS } from '../objectiveMetricProjection';
import { readVerdictFigures } from '../readVerdictFigures';

type Criterion = MetricGoalEvaluation['criteria'][number];
type Failure = NonNullable<MetricGoalEvaluation['failure']>;

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
        let moved = 'moved';
        if (criterion.relation === 'no-increase') {
            moved = 'rose';
        }
        if (criterion.relation === 'no-decrease') {
            moved = 'fell';
        }
        const [baseline] = criterion.baseline;
        const [observed] = criterion.observed;
        if (baseline === undefined || observed === undefined) {
            return `The preview breaks “${clause}”: ${subject} ${moved} from ${String(baseline ?? 'unavailable')} to ${String(observed ?? 'unavailable')} ${unit}, beyond its ${String(criterion.tolerance)} ${unit} tolerance.`;
        }
        const { from, to, movement } = readVerdictFigures({
            from: baseline,
            to: observed,
            relation: criterion.relation,
            tolerance: criterion.tolerance,
            rounding: 'significant',
            start: 3,
        });
        return `The preview breaks “${clause}”: ${subject} ${moved} from ${String(from)} to ${String(to)} ${unit}, a movement of ${String(movement)} ${unit}, beyond its ${String(criterion.tolerance)} ${unit} tolerance.`;
    }
    return `“${clause}” is unverified: no compatible baseline and preview measurement of ${subject} exists for this batch. Re-preview to measure it.`;
}
