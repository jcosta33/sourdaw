import { type MetricGoal, type MetricGoalState } from './metricGoalContractTypes';

type Binding = NonNullable<MetricGoalState['binding']>;

/**
 * The logical step a goal is judged across; an overall goal spans the whole batch from the live
 * project. Admission and the metric-goal preview both read it, so the preview measures exactly
 * the prefixes admission compares.
 */
export function readGoalPrefix(
    goal: Pick<MetricGoal, 'stepId'>,
    binding: Binding
): Binding['prefixes'][number] | undefined {
    if (goal.stepId === 'overall') {
        return { stepId: 'overall', before: null, after: binding.contentHash };
    }
    return binding.prefixes.find((entry) => entry.stepId === goal.stepId);
}
