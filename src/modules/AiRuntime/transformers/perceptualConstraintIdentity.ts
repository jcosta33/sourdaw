import { type PerceptualConstraintScope } from '../models/PerceptualConstraint';

/** The ids as a set: the same ids in any order and any repetition give the same key. */
export function readTargetSetKey(targetIds: readonly string[]): string {
    return JSON.stringify([...new Set(targetIds)].sort());
}

/**
 * What a constraint protects: its invariant over its scope taken as a set, whatever words stated it or
 * in what order they named the tracks.
 */
export function readPerceptualConstraintIdentity(constraint: {
    constraintId: string;
    scope: PerceptualConstraintScope;
}): string {
    const { scope } = constraint;
    return JSON.stringify([
        constraint.constraintId,
        scope.kind,
        scope.kind === 'mix' ? '' : readTargetSetKey(scope.trackIds),
    ]);
}
