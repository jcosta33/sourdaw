import { type SemanticCommandListMatchSelectorRecord } from '../models/SemanticCommandList';

import { type ArbitraryCommandListEvidence } from './compileArbitraryCommandList';

/**
 * Every `match` selector a compiled list carried, with the stable ids it resolved to, so
 * `resolveConfirmationAdmission` can re-resolve each one before rebinding an approval that changed
 * revision instead of trusting only its fingerprint check.
 *
 * `actionPositions` is read from each selector's item's `representativeCommandIndexes` rather than
 * its `commandStart`/`commandCount` range: canonical command deduplication can resolve every one of
 * an item's commands onto an earlier item's identical commands, leaving that item's own range empty
 * even though its intent is still carried by those earlier positions. `representativeCommandIndexes`
 * names the canonical position of each of the item's commands, deduplicated ones included, so it is
 * never empty for an item that produced at least one command.
 */
export function deriveMatchSelectorPredicates(
    compilerEvidence: ArbitraryCommandListEvidence | undefined
): SemanticCommandListMatchSelectorRecord[] {
    const actionPositionsByItemId = new Map(
        (compilerEvidence?.items ?? []).map((item) => [item.itemId, [...new Set(item.representativeCommandIndexes)]])
    );
    return (
        compilerEvidence?.selectors.flatMap((selector) => {
            if (selector.predicate === undefined) {
                return [];
            }
            const actionPositions = actionPositionsByItemId.get(selector.itemId);
            if (actionPositions === undefined) {
                // Selectors and items both come from the same compiler evidence, so a selector whose
                // item is missing there is a broken invariant, not a case to paper over with an empty
                // position list a later coverage check would silently accept.
                throw new Error(`Compiler evidence has no item "${selector.itemId}" for its own match selector.`);
            }
            return [
                {
                    itemId: selector.itemId,
                    entity: selector.predicate.entity,
                    where: selector.predicate.where,
                    match: selector.predicate.match,
                    condition: selector.predicate.condition,
                    excludeIds: selector.predicate.excludeIds,
                    quantity: selector.predicate.quantity,
                    stableIds: [...selector.stableIds],
                    actionPositions,
                },
            ];
        }) ?? []
    );
}
