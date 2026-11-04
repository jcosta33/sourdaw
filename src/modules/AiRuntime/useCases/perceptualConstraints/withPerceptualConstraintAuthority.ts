import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { type MetricGoal, type MetricGoalState, type MetricRequestAuthority } from '../metricGoalContractTypes';

import { PERCEPTUAL_CONSTRAINT_INVARIANTS } from './perceptualConstraintInvariants';

type CommandBatch = { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };

/** The whole arrangement, the extent the answer catalog's own `arrangement` range reads. */
function readArrangementRange(context: ProjectContext): MetricGoal['range'] {
    const endBeat = Math.max(
        0,
        ...context.tracks.flatMap((track) => track.clips.map((clip) => clip.endBeat)).filter(Number.isFinite)
    );
    return endBeat > 0 ? { startBeat: 0, endBeat, sectionId: null } : null;
}

function readConstraintGoals(reading: PerceptualConstraintReading, context: ProjectContext): MetricGoal[] {
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

/**
 * Joins the request's perceptual constraints to its frozen metric goals, as `hold` criteria on the
 * constrained scope over the whole arrangement, so the one admission that gates Confirm also refuses a
 * preview that moves a constrained metric past its tolerance. A request with no constraint keeps its
 * state exactly; a state already holding this request's constraint authority is never joined twice.
 */
export function withPerceptualConstraintAuthority(input: {
    state: MetricGoalState | null;
    reading: PerceptualConstraintReading;
    prompt: string;
    context: ProjectContext;
    commandBatch: CommandBatch;
}): MetricGoalState | null {
    const goals = readConstraintGoals(input.reading, input.context);
    if (goals.length === 0) {
        return input.state;
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new TypeError(parsed.reason);
    }
    const envelope = parsed.envelope;
    const requestDigest = digest(input.prompt.trim());
    const authorityId = `perceptual-constraints-${digest({ requestDigest, reading: input.reading })}`;
    const original = input.state ?? { schemaVersion: 1, authorities: [], steps: [], proofs: [], binding: null };
    if (original.authorities.some((authority) => authority.authorityId === authorityId)) {
        return input.state;
    }
    const authority: MetricRequestAuthority = {
        schemaVersion: 1,
        authorityId,
        origin: 'perceptual-constraint-reader',
        callId: null,
        turn: null,
        catalogId: 'perceptual-constraints-v1',
        requestDigest,
        revision: envelope.baseRevision,
        projectId: envelope.projectId,
        selection: getCreativeSelectionSnapshot(input.context),
        kind: 'perceptual',
        goals,
        creativeAuthority: null,
    };
    const state = { ...structuredClone(original), authorities: [...original.authorities, authority] };
    if (state.steps.length > 0) {
        return state;
    }
    // A constraint holds over the whole batch: with no logical steps of its own, the batch is one step.
    const overall = {
        stepId: 'overall',
        commandCount: envelope.commands.length,
        operationTypes: envelope.commands.map((command) => command.operation),
        recipePrefixHash: null,
    };
    return { ...state, steps: [overall] };
}
