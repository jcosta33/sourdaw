import {
    type BulkSetReplaySelector,
    type BulkSetSlice,
    SEMANTIC_COMMAND_LIST_MAX_SET_TARGETS,
    type SemanticCommandListRoleFamily,
} from '../models/SemanticCommandList';

import { resolveSemanticCommandListSelector, type SemanticCommandListCandidate } from './semanticCommandListCandidates';

type BulkSetSliceReplay = { status: 'accepted' } | { status: 'rejected'; reason: string };

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
