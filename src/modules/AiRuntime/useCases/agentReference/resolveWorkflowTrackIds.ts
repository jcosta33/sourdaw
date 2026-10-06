import { type ProjectContext } from '../../models/ProjectContext';
import { type SemanticCommandListMatch } from '../../models/SemanticCommandList';
import {
    collectSemanticCommandListCandidates,
    resolveSemanticCommandListSelector,
} from '../../services/semanticCommandListCandidates';
import { CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';

/**
 * The tracks a workflow scope's candidate set names, resolved through the same selector resolver
 * the structured command list compiles and replays with, so a `roleFamily`, `kind`, name or
 * frozen predicate means the same thing in a workflow scope as in a provider's `match`. Ids come
 * back in project order. A match that names no track resolves to none: whether an empty set is a
 * refusal stays the workflow's own decision.
 */
export function resolveWorkflowTrackIds(
    context: ProjectContext,
    itemId: string,
    match: SemanticCommandListMatch
): string[] {
    const resolution = resolveSemanticCommandListSelector({
        candidates: collectSemanticCommandListCandidates({
            context,
            roleFamilyByCanonicalRole: CANONICAL_ROLE_TO_RECIPE_ROLE,
        }),
        context,
        itemId,
        roleFamilyByCanonicalRole: CANONICAL_ROLE_TO_RECIPE_ROLE,
        selector: {
            entity: 'track',
            match,
            quantity: { unit: 'targets', maximum: context.tracks.length },
        },
    });
    return resolution.status === 'accepted' ? resolution.stableIds : [];
}
