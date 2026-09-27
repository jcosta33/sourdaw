/**
 * Request-size fitting for one unit's evidence.
 *
 * The provider caps a request's state plus its longest question, and JSON escaping is not free: every
 * newline in a source file costs two bytes on the wire. Regions are therefore costed by their
 * serialized size, not their raw size.
 *
 * A region is supplied whole or not at all. Cutting one to a prefix was the earlier policy, and it
 * was wrong in both directions: the model answered over a fragment while the report said the region
 * had been sent, and a prefix cannot answer a question about a side of a change. A region that does
 * not fit is dropped, counted, and named — so the questions that needed it report the evidence as not
 * supplied instead of answering from a third of it.
 *
 * The fitter owns both halves of that decision: what a region costs, and the order the regions it was
 * given are attempted in. Both read the region, never the position the collector's admission left it
 * at, so the same admitted set fits the same regions whatever order admission attempted it in.
 */

import { EVIDENCE_SIDES, type EvidenceReference, type EvidenceSide } from './contracts.ts';
import { compareLexicographic, evidenceSidePrefix, type SemanticEvidenceSet } from './evidence.ts';

/**
 * One region exactly as it is sent. `fitUnitEvidence` costs regions through this same shape, so the
 * budget it enforces and the payload the provider receives cannot disagree about a region's size.
 */
export function serializedRegion(reference: EvidenceReference, content: string): Record<string, unknown> {
    return {
        path: reference.path,
        side: reference.side,
        revisionSha: reference.revisionSha,
        startLine: reference.startLine,
        endLine: reference.endLine,
        contentSha256: reference.contentHash,
        content,
    };
}

/**
 * The key every region is charged under: its side prefix and a fixed two-digit ordinal.
 *
 * The identifier's ordinal is the position admission attempted the region at, so charging the
 * identifier a region happens to hold made an identical admitted set cost a different number of bytes
 * as soon as an unrelated earlier path moved that position — one more byte per region each time an
 * ordinal gained a digit — and a request sitting on the budget boundary then carried a different set
 * of regions. A region's cost is a property of the region and its content, so every region is charged
 * this one key width whatever ordinal it holds.
 *
 * Two digits keeps the charge at or above the bytes the payload spends on the key for every identifier
 * the collector's own total budget makes ordinary. A third-digit ordinal — reached once a change admits
 * a hundred regions — costs the payload one byte more than this key per region, and the structural
 * bytes the charge counts around a lone region (the braces the evidence map itself pays once) are worth
 * that byte and more. The region's serialized form, its escaping and its field bytes stay exact.
 */
function chargedRegionKey(reference: EvidenceReference): string {
    return `${evidenceSidePrefix(reference.side)}00`;
}

/**
 * The bytes one region costs inside a request's evidence map.
 *
 * The serialized size is what matters, not the raw byte count: JSON escapes every newline in a source
 * file to two bytes, so a raw-byte estimate under-counts by roughly one byte per line and a unit sized
 * by it overruns the request limit. Only the key is charged at the fixed width above, so the charge
 * tracks the payload's escaping and field bytes and never the identifier's ordinal.
 */
export function regionCost(reference: EvidenceReference, content: string): number {
    return Buffer.byteLength(
        JSON.stringify({ [chargedRegionKey(reference)]: serializedRegion(reference, content) }),
        'utf8'
    );
}

/**
 * The order one unit's regions are attempted in, read from the regions themselves: content bytes, then
 * path, bounds, and side — the order admission uses *inside one tier*, read from the region rather than
 * from where the collector's tiers left it.
 *
 * The collector's order ranks units, so a promotion moves a region's position in the change-wide array
 * while nothing about the region changes; attempting a unit's regions in that array's order carried
 * different evidence for the same admitted set, because whichever region admission attempted first took
 * the room the next one needed. The ascending-byte key is what keeps a unit's carriage where admission
 * already put it whenever admission ordered the unit's own sides by their own size.
 */
function compareFitOrder(
    bytes: ReadonlyMap<string, number>,
    left: EvidenceReference,
    right: EvidenceReference
): number {
    const leftBytes = bytes.get(left.evidenceId) ?? 0;
    const rightBytes = bytes.get(right.evidenceId) ?? 0;
    if (leftBytes !== rightBytes) {
        return leftBytes - rightBytes;
    }
    const byPath = compareLexicographic(left.path, right.path);
    if (byPath !== 0) {
        return byPath;
    }
    if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
    }
    if (left.endLine !== right.endLine) {
        return left.endLine - right.endLine;
    }
    const bySide = EVIDENCE_SIDES.indexOf(left.side) - EVIDENCE_SIDES.indexOf(right.side);
    if (bySide !== 0) {
        return bySide;
    }
    return compareLexicographic(left.revisionSha, right.revisionSha);
}

/** One region set in its own stable order, with each region's content measured once. */
function inFitOrder(set: SemanticEvidenceSet, references: readonly EvidenceReference[]): EvidenceReference[] {
    const bytes = new Map(
        references.map((reference) => [
            reference.evidenceId,
            Buffer.byteLength(set.contents.get(reference.evidenceId) ?? '', 'utf8'),
        ])
    );
    return [...references].sort((left, right) => compareFitOrder(bytes, left, right));
}

/**
 * Fits one unit's regions inside the per-request state budget.
 *
 * A region that does not fit is dropped, counted, and its side recorded, so the questions that
 * needed it report the evidence as not supplied rather than answering over a fragment; later regions
 * are dropped once the budget is gone. Context regions are offered last, so an oversized
 * implementation costs a contract rather than the unit. Whatever is lost is reported, because an
 * omitted region is not evidence that the region is safe.
 */
function fitRegions(
    set: SemanticEvidenceSet,
    candidates: readonly EvidenceReference[],
    maxBytes: number
): {
    references: EvidenceReference[];
    contents: Map<string, string>;
    used: number;
    dropped: number;
    droppedSides: ReadonlySet<EvidenceSide>;
} {
    const references: EvidenceReference[] = [];
    const contents = new Map<string, string>();
    const droppedSides = new Set<EvidenceSide>();
    let used = 0;
    let dropped = 0;

    for (const reference of candidates) {
        const text = set.contents.get(reference.evidenceId) ?? '';
        const full = regionCost(reference, text);
        if (used + full > maxBytes) {
            dropped += 1;
            droppedSides.add(reference.side);
            continue;
        }
        used += full;
        references.push(reference);
        contents.set(reference.evidenceId, text);
    }
    return { references, contents, used, dropped, droppedSides };
}

/**
 * How much of a request's evidence budget the unit's context may take. Contract files are large and
 * mostly unrelated to any one unit, and the provider documents that unrelated state reduces accuracy,
 * so they get a bounded share ahead of the change's own source rather than whatever is left over —
 * otherwise a whole-file contract never fits and every contract-requiring rule is permanently
 * unresolved.
 *
 * The share is reserved whenever the unit carries any context region, contract or implementation, so
 * the reserve protects what the unit carries rather than only the documents the collector charged for
 * it. That can reduce the unit's own evidence below its request: an implementation after side supplied
 * as context takes the same share as a charged contract document, and a region the reserve cannot make
 * room for is not thereby lost — the context fit still receives whatever the own sides leave.
 */
const CONTEXT_BUDGET_SHARE = 0.4;

/** One fitted region set: the regions kept, their contents, and the sides dropped by the fitter. */
export type FittedRegions = {
    readonly references: EvidenceReference[];
    readonly contents: Map<string, string>;
    readonly droppedSides: ReadonlySet<EvidenceSide>;
};

/** One unit's fitted evidence, with the own regions and the context regions kept distinct. */
export type FittedUnitEvidence = {
    readonly own: FittedRegions;
    readonly context: FittedRegions;
    readonly dropped: number;
};

/**
 * Fits one unit's regions inside the per-request state budget.
 *
 * Each set is attempted in its own stable order rather than in the order the collector admitted it:
 * admission's order ranks units, so it is no property of the regions a request was given, and reading
 * it here made an identical admitted set carry different evidence. A region that does not fit is
 * dropped, counted, and its side recorded, so the questions that needed it report the evidence as not
 * supplied rather than answering over a fragment; later regions are dropped once the budget is gone.
 * Context regions are offered last, so an oversized implementation costs a contract rather than the
 * unit, and the bounded share they reserve ahead of the unit's own regions is the one exception to that
 * order. Whatever is lost is reported, because an omitted region is not evidence that the region is
 * safe.
 *
 * The own and context fits are returned separately rather than as one union, because a dropped side
 * means different things in each: an own-side drop unsupplies that side of the unit, while a context
 * drop must not. The requirement predicate resolves a side against the set it belongs to.
 */
export function fitUnitEvidence(
    set: SemanticEvidenceSet,
    own: readonly EvidenceReference[],
    context: readonly EvidenceReference[],
    maxBytes: number
): FittedUnitEvidence {
    const ownOrder = inFitOrder(set, own);
    const contextOrder = inFitOrder(set, context);
    const contextBudget = contextOrder.length === 0 ? 0 : Math.floor(maxBytes * CONTEXT_BUDGET_SHARE);
    const ownFitted = fitRegions(set, ownOrder, maxBytes - contextBudget);
    const contextFitted = fitRegions(set, contextOrder, maxBytes - ownFitted.used);
    return {
        own: {
            references: ownFitted.references,
            contents: ownFitted.contents,
            droppedSides: ownFitted.droppedSides,
        },
        context: {
            references: contextFitted.references,
            contents: contextFitted.contents,
            droppedSides: contextFitted.droppedSides,
        },
        dropped: ownFitted.dropped + contextFitted.dropped,
    };
}

/**
 * The reduced-unit record's reason. When the per-request fitter dropped sides, the reason names them
 * in the fixed side order so a reader can tell which side was cut. The caller emits it only for a unit
 * whose fitter actually dropped a side, so a unit reduced by nothing but the collector's own
 * withholding is never recorded as a request-budget reduction; the plain form stays here as the shape
 * reports persisted before that guard carry, and stays readable to `semanticReviewContext`.
 */
export function unitReductionReason(dropped: ReadonlySet<EvidenceSide>): string {
    const sides = [...dropped].sort((left, right) => EVIDENCE_SIDES.indexOf(left) - EVIDENCE_SIDES.indexOf(right));
    if (sides.length === 0) {
        return 'unit-evidence-reduced-below-request-budget';
    }
    return `unit-evidence-reduced-below-request-budget (${sides.join(', ')})`;
}
