import { type MetricGoal } from './metricGoalContractTypes';

/** Whether two goals on the same subjects, metric and range ask for movements that cannot both hold. */
export function hasContradictoryMetricGoals(goals: readonly MetricGoal[]): boolean {
    for (const left of goals) {
        const sameAxis = (right: MetricGoal) =>
            left.metricId === right.metricId &&
            left.band === right.band &&
            JSON.stringify(left.targetIds) === JSON.stringify(right.targetIds) &&
            JSON.stringify(left.referenceTargetIds) === JSON.stringify(right.referenceTargetIds) &&
            JSON.stringify(left.range) === JSON.stringify(right.range);
        if (
            goals.some(
                (right) =>
                    sameAxis(right) &&
                    ((left.relation === 'increase' && ['decrease', 'hold', 'no-increase'].includes(right.relation)) ||
                        (left.relation === 'decrease' && ['hold', 'no-decrease'].includes(right.relation)) ||
                        (left.relation === 'greater-than-current' && right.relation === 'less-than-current'))
            )
        ) {
            return true;
        }
    }
    return false;
}
