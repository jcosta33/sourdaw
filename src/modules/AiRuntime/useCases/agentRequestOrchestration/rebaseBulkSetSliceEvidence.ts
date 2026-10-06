import { type ProjectContext } from '../../models/ProjectContext';
import { collectSemanticCommandListCandidates } from '../../services/semanticCommandListCandidates';
import { CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';
import { type ArbitraryCommandListEvidence } from '../compileArbitraryCommandList';

type RebasedSlice =
    { status: 'rebased'; evidence: ArbitraryCommandListEvidence } | { status: 'rejected'; reason: string };

type Precondition = ArbitraryCommandListEvidence['selectors'][number]['preconditions'][number];

function refreshRunTouchedPrecondition(
    precondition: Precondition,
    runTouchedTargetIds: ReadonlySet<string>,
    candidatesById: ReadonlyMap<string, unknown>
): Precondition {
    if (!runTouchedTargetIds.has(precondition.stableId)) {
        return precondition;
    }
    return { stableId: precondition.stableId, fingerprint: JSON.stringify(candidatesById.get(precondition.stableId)) };
}

/**
 * Moves a later batch's compiled slice onto the revision it is now proposed at. A target the slice
 * names that is gone is refused outright. A target an earlier batch of the same run already changed
 * is re-fingerprinted at its live state, because that change is the run's own and approved. Every
 * other target keeps the fingerprint it was compiled with, so a change anyone else made to it since
 * still fails the evidence validator and refuses the batch.
 */
export function rebaseBulkSetSliceEvidence(input: {
    evidence: ArbitraryCommandListEvidence;
    context: ProjectContext;
    revision: string;
    runTouchedTargetIds: ReadonlySet<string>;
}): RebasedSlice {
    const candidatesById = new Map(
        collectSemanticCommandListCandidates({
            context: input.context,
            roleFamilyByCanonicalRole: CANONICAL_ROLE_TO_RECIPE_ROLE,
        }).map((candidate) => [candidate.id, candidate])
    );
    const missing = input.evidence.selectors
        .flatMap((selector) => selector.preconditions)
        .find((precondition) => !candidatesById.has(precondition.stableId));
    if (missing !== undefined) {
        return { status: 'rejected', reason: `Target ${missing.stableId} is no longer in the project.` };
    }
    return {
        status: 'rebased',
        evidence: {
            ...structuredClone(input.evidence),
            snapshotRevision: input.revision,
            selectors: input.evidence.selectors.map((selector) => ({
                ...structuredClone(selector),
                preconditions: selector.preconditions.map((precondition) =>
                    refreshRunTouchedPrecondition(precondition, input.runTouchedTargetIds, candidatesById)
                ),
            })),
        },
    };
}
