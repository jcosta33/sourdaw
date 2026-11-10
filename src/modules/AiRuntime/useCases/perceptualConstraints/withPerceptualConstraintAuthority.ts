import { getExecutableAppActionEffect, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import { getCreativeSelectionSnapshot } from '../../models/CreativeInterpretation';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { type MetricGoal, type MetricGoalState, type MetricRequestAuthority } from '../metricGoalContractTypes';

import { readPerceptualConstraintGoals } from './readPerceptualConstraintGoals';

type CommandBatch = { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };

/** Command declares a protection-only write for an operation that moves no audio, now or conditionally. */
function changesNoSound(operation: string): boolean {
    const effect = getExecutableAppActionEffect(operation);
    return (
        effect !== null &&
        effect.dimensions.every((dimension) => dimension === 'protection') &&
        (effect.conditional ?? []).length === 0 &&
        (effect.creates ?? []).length === 0 &&
        (effect.removes ?? []).length === 0
    );
}

/** What one constraint goal asks for, whichever authority or reading position states it. */
function readHoldKey(goal: MetricGoal): string | null {
    if (goal.source.kind !== 'constraint') {
        return null;
    }
    const { constraintId, clause } = goal.source;
    return JSON.stringify([
        constraintId,
        clause,
        goal.relation,
        goal.metricId,
        goal.band,
        goal.targetIds,
        goal.tolerance,
    ]);
}

/**
 * Joins the request's perceptual constraints to its frozen metric goals, as `hold` criteria on the
 * constrained scope over the whole arrangement, so the one admission that gates Confirm also refuses a
 * preview that moves a constrained metric past its tolerance. A request with no constraint keeps its
 * state exactly, and a hold the state already holds, the card's own in a refinement, is never joined twice.
 */
export function withPerceptualConstraintAuthority(input: {
    state: MetricGoalState | null;
    reading: PerceptualConstraintReading;
    prompt: string;
    context: ProjectContext;
    commandBatch: CommandBatch;
}): MetricGoalState | null {
    const original = input.state ?? { schemaVersion: 1, authorities: [], steps: [], proofs: [], binding: null };
    // A refinement inherits the card's state with the holds its constraints already joined, so only
    // a hold no authority of the state holds yet is joined, and never twice.
    const held = new Set(original.authorities.flatMap((authority) => authority.goals.map(readHoldKey)));
    const goals = readPerceptualConstraintGoals(input.reading, input.context).filter(
        (goal) => !held.has(readHoldKey(goal))
    );
    if (goals.length === 0) {
        return input.state;
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new TypeError(parsed.reason);
    }
    const envelope = parsed.envelope;
    // A batch that changes no sound has no metric a hold could see move: the production brief records
    // the constraint as intent instead, and a hold would only ask for a measurement of nothing.
    if (envelope.commands.every((command) => changesNoSound(command.operation))) {
        return input.state;
    }
    const requestDigest = digest(input.prompt.trim());
    const authorityId = `perceptual-constraints-${digest({ requestDigest, reading: input.reading })}`;
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
