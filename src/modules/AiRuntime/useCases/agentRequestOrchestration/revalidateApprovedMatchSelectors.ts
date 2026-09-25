import { type SemanticCommandListMatchSelectorRecord } from '../../models/SemanticCommandList';
import {
    collectSemanticCommandListCandidates,
    resolveSemanticCommandListSelector,
} from '../../services/semanticCommandListCandidates';
import { CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';
import { getProjectContext } from '../getProjectContext';

export type MatchSelectorPredicateRevalidation = { status: 'unchanged' } | { status: 'invalidated'; detail: string };

/**
 * Re-resolves every `match` selector an approved batch carried against the live project, called
 * from `resolveConfirmationAdmission`'s changed-revision branch before it rebinds that batch to the
 * new revision.
 *
 * `classifyAgentProjectDivergence` only compares the fingerprints of the ids a selector already
 * resolved: a track the compiled predicate never saw — one added, renamed into the matched role
 * family, or newly satisfying some other predicate field after approval — changes no
 * already-resolved candidate's fingerprint, so it passes that check invisibly and the batch would
 * rebind without it. Replaying the same selector against the live project through the shared
 * resolver both the compiler and the evidence validator use is the only way to see a resolved set
 * that would come out different today. A batch with no carried selectors, and one whose selectors
 * still resolve to the same id sets, report `unchanged` so today's rebind proceeds exactly as before.
 */
export function revalidateApprovedMatchSelectors(
    matchSelectorPredicates: readonly SemanticCommandListMatchSelectorRecord[]
): MatchSelectorPredicateRevalidation {
    if (matchSelectorPredicates.length === 0) {
        return { status: 'unchanged' };
    }
    const context = getProjectContext();
    const candidates = collectSemanticCommandListCandidates({
        context,
        roleFamilyByCanonicalRole: CANONICAL_ROLE_TO_RECIPE_ROLE,
    });
    for (const record of matchSelectorPredicates) {
        const resolved = resolveSemanticCommandListSelector({
            candidates,
            context,
            itemId: record.itemId,
            roleFamilyByCanonicalRole: CANONICAL_ROLE_TO_RECIPE_ROLE,
            selector: {
                entity: record.entity,
                where: record.where,
                condition: record.condition,
                match: record.match,
                excludeIds: record.excludeIds,
                quantity: record.quantity,
            },
        });
        if (resolved.status !== 'accepted') {
            return {
                status: 'invalidated',
                detail: `Match selector ${record.itemId} no longer resolves against the live project: ${resolved.reason}`,
            };
        }
        const originalIds = [...record.stableIds].sort();
        const liveIds = [...resolved.stableIds].sort();
        if (JSON.stringify(originalIds) !== JSON.stringify(liveIds)) {
            return {
                status: 'invalidated',
                detail: `Match selector ${record.itemId} now resolves a different target set than the approved batch carried.`,
            };
        }
    }
    return { status: 'unchanged' };
}
