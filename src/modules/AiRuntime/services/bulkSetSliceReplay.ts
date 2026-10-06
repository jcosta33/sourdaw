import {
    type BulkSetReplaySelector,
    type BulkSetRunWrittenFact,
    type BulkSetSlice,
    SEMANTIC_COMMAND_LIST_MAX_SET_TARGETS,
    type SemanticCommandListRoleFamily,
} from '../models/SemanticCommandList';

import { resolveSemanticCommandListSelector, type SemanticCommandListCandidate } from './semanticCommandListCandidates';

type BulkSetSliceReplay = { status: 'accepted' } | { status: 'rejected'; reason: string };

function withRunWrittenFact(
    candidate: SemanticCommandListCandidate,
    fact: BulkSetRunWrittenFact
): SemanticCommandListCandidate {
    switch (fact.field) {
        case 'muted':
            return { ...candidate, muted: fact.value ?? undefined };
        case 'locked':
            return { ...candidate, locked: fact.value ?? undefined };
        case 'bypassed':
            return { ...candidate, bypassed: fact.value ?? undefined };
        case 'ownerMuted':
            return { ...candidate, ownerMuted: fact.value ?? undefined };
        case 'ownerDeviceTypes':
            return { ...candidate, ownerDeviceTypes: fact.value ?? undefined };
        case 'ownerTags':
            return { ...candidate, ownerTags: fact.value ?? undefined };
    }
    const exhaustive: never = fact;
    return exhaustive;
}

/**
 * The live candidate universe with every fact the run's own earlier batches wrote restored to the
 * value it held when the list was compiled. Every other fact stays live, so a selector replayed over
 * this universe sees exactly the outside changes and none of the run's own.
 */
export function restoreRunWrittenFacts(
    candidates: readonly SemanticCommandListCandidate[],
    facts: readonly BulkSetRunWrittenFact[] | undefined
): SemanticCommandListCandidate[] {
    if (facts === undefined || facts.length === 0) {
        return [...candidates];
    }
    return candidates.map((candidate) =>
        facts
            .filter((fact) => fact.candidateId === candidate.id)
            .reduce((restored, fact) => withRunWrittenFact(restored, fact), candidate)
    );
}

/**
 * Re-resolves the selector one slice of a bulk set was compiled from and decides whether the set
 * still holds. Earlier batches of the same run may have changed the members they carried — muted
 * them, renamed them — so those members are set aside, and what the live project resolves beyond them
 * must be exactly the members this slice and every later slice still owe. A member that vanished,
 * stopped matching, or that the project gained since is a different set, and the slice is refused
 * rather than silently run against a set nobody approved.
 *
 * The recorded quantity counted the whole set when nothing had run yet, so it is relaxed to the set
 * bound here: the comparison below is what decides membership.
 */
export function replayBulkSetSlice(input: {
    candidates: readonly SemanticCommandListCandidate[];
    context: Parameters<typeof resolveSemanticCommandListSelector>[0]['context'];
    itemId: string;
    roleFamilyByCanonicalRole: Readonly<Record<string, SemanticCommandListRoleFamily | null>>;
    selector: BulkSetReplaySelector;
    slice: BulkSetSlice;
}): BulkSetSliceReplay {
    const resolved = resolveSemanticCommandListSelector({
        candidates: input.candidates,
        context: input.context,
        itemId: input.itemId,
        roleFamilyByCanonicalRole: input.roleFamilyByCanonicalRole,
        selector: { ...input.selector, quantity: { unit: 'targets', maximum: SEMANTIC_COMMAND_LIST_MAX_SET_TARGETS } },
    });
    if (resolved.status === 'rejected') {
        return { status: 'rejected', reason: resolved.reason };
    }
    const carriedEarlier = new Set(input.slice.setStableIds.slice(0, input.slice.offset));
    const owed = input.slice.setStableIds.slice(input.slice.offset);
    const live = resolved.stableIds.filter((stableId) => !carriedEarlier.has(stableId));
    const owedIds = new Set(owed);
    if (live.length !== owed.length || owedIds.size !== owed.length || !live.every((id) => owedIds.has(id))) {
        return {
            status: 'rejected',
            reason: `Bulk selector ${input.itemId} no longer resolves the set its earlier batches started from.`,
        };
    }
    return { status: 'accepted' };
}
