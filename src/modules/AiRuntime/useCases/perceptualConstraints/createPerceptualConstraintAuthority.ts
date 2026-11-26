import { digest } from '#/utils/canonicalDigest';

import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type MetricGoal, type MetricRequestAuthority } from '../metricGoalContractTypes';

/** The authority a reading's constraint goals join a request's state as, wherever the request is admitted. */
export function createPerceptualConstraintAuthority(input: {
    reading: PerceptualConstraintReading;
    goals: MetricGoal[];
    requestDigest: string;
    revision: string;
    projectId: string;
    selection: MetricRequestAuthority['selection'];
}): MetricRequestAuthority {
    return {
        schemaVersion: 1,
        authorityId: `perceptual-constraints-${digest({ requestDigest: input.requestDigest, reading: input.reading })}`,
        origin: 'perceptual-constraint-reader',
        callId: null,
        turn: null,
        catalogId: 'perceptual-constraints-v1',
        requestDigest: input.requestDigest,
        revision: input.revision,
        projectId: input.projectId,
        selection: input.selection,
        kind: 'perceptual',
        goals: input.goals,
        creativeAuthority: null,
    };
}
