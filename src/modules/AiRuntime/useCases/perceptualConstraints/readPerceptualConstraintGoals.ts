import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { type MetricGoal } from '../metricGoalContractTypes';
import { readArrangementRange } from '../readArrangementRange';

import { PERCEPTUAL_CONSTRAINT_INVARIANTS } from './perceptualConstraintInvariants';

/**
 * The hold goals a reading's constraints compile to: each measured invariant on each constrained
 * subject over the whole arrangement, and one `unsupported` goal per clause no measurement verifies.
 */
export function readPerceptualConstraintGoals(
    reading: PerceptualConstraintReading,
    context: Pick<ProjectContext, 'tracks'>
): MetricGoal[] {
    const range = readArrangementRange(context);
    const measured = reading.constraints.flatMap((constraint, constraintIndex) => {
        const targetIds = constraint.scope.kind === 'mix' ? ['master'] : constraint.scope.trackIds;
        return targetIds.flatMap((targetId) =>
            PERCEPTUAL_CONSTRAINT_INVARIANTS[constraint.constraintId].map((metric): MetricGoal => ({
                goalId: `constraint:${String(constraintIndex)}:${targetId}:${metric.metricId}:${metric.band ?? 'all'}`,
                stepId: 'overall',
                metricId: metric.metricId,
                band: metric.band,
                targetIds: [targetId],
                referenceTargetIds: [],
                range,
                relation: 'hold',
                targetValue: null,
                tolerance: metric.tolerance,
                source: { kind: 'constraint', constraintId: constraint.constraintId, clause: constraint.clause },
            }))
        );
    });
    const unsupported = reading.unsupported.map((constraint, index): MetricGoal => ({
        goalId: `constraint-unsupported:${String(index)}`,
        stepId: 'overall',
        metricId: null,
        band: null,
        targetIds: [],
        referenceTargetIds: [],
        range: null,
        relation: 'unsupported',
        targetValue: null,
        tolerance: 0,
        source: { kind: 'constraint', constraintId: 'unsupported', clause: constraint.clause },
    }));
    return [...measured, ...unsupported];
}
