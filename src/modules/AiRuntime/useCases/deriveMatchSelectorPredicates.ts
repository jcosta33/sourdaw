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
    compilerEvidence: ArbitraryCommandListEvidence | undefined,
    actionPositionOffset = 0
): SemanticCommandListMatchSelectorRecord[] {
    const actionPositionsByItemId = new Map(
        (compilerEvidence?.items ?? []).map((item) => [item.itemId, [...new Set(item.representativeCommandIndexes)]])
    );
    return (
        compilerEvidence?.selectors.flatMap((selector) => {
            const replayed = getReplayedSelector(selector);
            if (replayed === undefined) {
                return [];
            }
            const actionPositions = actionPositionsByItemId.get(selector.itemId);
            if (actionPositions === undefined) {
                // Selectors and items both come from the same compiler evidence, so a selector whose
                // item is missing there is a broken invariant, not a case to paper over with an empty
                // position list a later coverage check would silently accept.
                throw new Error(`Compiler evidence has no item "${selector.itemId}" for its own match selector.`);
            }
            const record: SemanticCommandListMatchSelectorRecord = {
                itemId: selector.itemId,
                entity: replayed.entity,
                where: replayed.where,
                match: replayed.match,
                condition: replayed.condition,
                excludeIds: replayed.excludeIds,
                quantity: replayed.quantity,
                stableIds: [...selector.stableIds],
                actionPositions: actionPositions.map((position) => position + actionPositionOffset),
            };
            // A batch carrying one slice of a larger set is re-resolved beyond the members earlier
            // batches carried, so the record keeps where in the set this batch sits.
            if (selector.slice !== undefined) {
                record.slice = { setStableIds: [...selector.slice.setStableIds], offset: selector.slice.offset };
            }
            const runWrittenFacts = compilerEvidence?.runWrittenFacts;
            if (runWrittenFacts !== undefined) {
                record.runWrittenFacts = structuredClone(runWrittenFacts);
            }
            return [record];
        }) ?? []
    );
}

type SelectorEvidence = ArbitraryCommandListEvidence['selectors'][number];

/**
 * The selector fields an approval re-resolves: a `match` selector's own, or — for a `where`-only
 * selector carried as one slice of a larger set — the slice's replay fields, so a set that gains or
 * loses a member while a later batch waits for approval is refused whichever form named it.
 */
function getReplayedSelector(
    selector: SelectorEvidence
): Omit<SemanticCommandListMatchSelectorRecord, 'itemId' | 'stableIds' | 'actionPositions'> | undefined {
    if (selector.predicate !== undefined) {
        return selector.predicate;
    }
    if (selector.slice === undefined) {
        return undefined;
    }
    return {
        ...selector.slice.selector,
        quantity: { unit: 'targets', exactly: selector.slice.setStableIds.length },
    };
}
