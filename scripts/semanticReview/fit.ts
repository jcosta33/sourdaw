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
 * at, so the same admitted set fits the same regions whatever order admission attempted it in. The
 * order it reads keeps the precedence admission chose inside one unit: a unit's context is attempted
 * contract-first, and its own regions put the side admission attempted first ahead of the other.
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
 * The bound that width keeps: the charge stays at or above the payload's own bytes while every
 * identifier stays below a fourth digit — fewer than a thousand admitted regions — because the braces
 * the charge counts around each region cover the one byte an identifier of that length spends beyond
 * the charge key. The thousandth admitted region's identifier takes a fifth byte the charge does not
 * count, so from there the charge under-counts the request by one byte per region (two from ten
 * thousand), and a unit whose request sits on the cap can exceed it. The region's serialized form, its
 * escaping and its field bytes stay exact, so a longer identifier is the only way the charge and the
 * payload disagree.
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
 * One region set measured once: each region's content bytes, and, for a unit's own set, the bytes each
 * side's regions add up to.
 */
type FitBytes = {
    readonly region: ReadonlyMap<string, number>;
    readonly side: ReadonlyMap<EvidenceSide, number>;
};

function measureFitBytes(set: SemanticEvidenceSet, references: readonly EvidenceReference[]): FitBytes {
    const region = new Map<string, number>();
    const side = new Map<EvidenceSide, number>();
    for (const reference of references) {
        const bytes = Buffer.byteLength(set.contents.get(reference.evidenceId) ?? '', 'utf8');
        region.set(reference.evidenceId, bytes);
        side.set(reference.side, (side.get(reference.side) ?? 0) + bytes);
    }
    return { region, side };
}

/**
 * The bounds every region is identified by, in the order admission attempts regions of one side: path,
 * bounds, side. Two regions of one side differ in path or bounds — admission mints one region per
 * revision, path, side, and range — so this is the hunk order the collector admitted that side in,
 * read from the region rather than from the array's positions.
 */
function compareRegionBounds(left: EvidenceReference, right: EvidenceReference): number {
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

/**
 * The region's own key: content bytes, then the bounds order. Admission's order inside one tier is a
 * byte-ascending tie-break over exactly this key, so reading it here keeps a region's rank where the
 * collector put it whenever the collector ordered the regions by their own size.
 */
function compareRegionKey(bytes: FitBytes, left: EvidenceReference, right: EvidenceReference): number {
    const leftBytes = bytes.region.get(left.evidenceId) ?? 0;
    const rightBytes = bytes.region.get(right.evidenceId) ?? 0;
    if (leftBytes !== rightBytes) {
        return leftBytes - rightBytes;
    }
    return compareRegionBounds(left, right);
}

/**
 * Whether one context region is a contract document the unit's rules charged, or an implementation
 * region the planner supplied as context because a rule declared it needed the implementation. The
 * charged contract is the provenance admission ranks ahead of the implementation, and it is read from
 * the region's own side.
 */
function contextProvenanceRank(reference: EvidenceReference): number {
    return reference.side === 'context' ? 0 : 1;
}

/**
 * The order one unit's context regions are attempted in: the charged contract-context regions first,
 * then the implementation regions supplied as context, and inside each provenance the region key.
 *
 * The collector admits the contract-context tier ahead of bulk, so a flat key over per-region bytes let
 * a smaller implementation region take the room the contract document the unit's rules charged needed,
 * and the request then reported a contract-witnessing token missing that admission had supplied.
 * Sorting by provenance first keeps the precedence admission chose; the key inside a provenance keeps
 * the property the flat order was added for, so the same admitted set fits the same context regions
 * whatever order the collector assembled them in.
 */
function compareContextOrder(bytes: FitBytes, left: EvidenceReference, right: EvidenceReference): number {
    const byProvenance = contextProvenanceRank(left) - contextProvenanceRank(right);
    if (byProvenance !== 0) {
        return byProvenance;
    }
    return compareRegionKey(bytes, left, right);
}

/**
 * The order one unit's own regions are attempted in: the side whose regions add up to fewer bytes
 * first, then the other, and inside a side the bounds order.
 *
 * Admission attempts a file's two sides as two units, ranked by each side's aggregate chargeable bytes,
 * with the before side first on a tie. A flat key over per-region bytes instead let three small after
 * hunks take the room a fatter after hunk had under admission, so the unit carried different hunks of
 * its own change. The aggregate is read from the regions the unit holds rather than from admission's
 * array position, so the same admitted set fits the same own regions whatever order the collector
 * assembled them in; the tie falls to the before side, exactly as admission's own side order does.
 */
function compareOwnOrder(bytes: FitBytes, left: EvidenceReference, right: EvidenceReference): number {
    const leftSide = bytes.side.get(left.side) ?? 0;
    const rightSide = bytes.side.get(right.side) ?? 0;
    if (leftSide !== rightSide) {
        return leftSide - rightSide;
    }
    return compareRegionBounds(left, right);
}

/** One region set in its own stable order, with each region's content measured once. */
function inFitOrder(
    set: SemanticEvidenceSet,
    references: readonly EvidenceReference[],
    compare: (bytes: FitBytes, left: EvidenceReference, right: EvidenceReference) => number
): EvidenceReference[] {
    const bytes = measureFitBytes(set, references);
    return [...references].sort((left, right) => compare(bytes, left, right));
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
 * it here made an identical admitted set carry different evidence. That order keeps the precedence
 * admission chose inside one unit: its own regions put the side with the smaller aggregate first, and
 * its context regions put the charged contract documents ahead of the implementation supplied as
 * context. A region that does not fit is dropped, counted, and its side recorded, so the questions that
 * needed it report the evidence as not supplied rather than answering over a fragment; later regions
 * are dropped once the budget is gone. Context regions are offered last, so an oversized implementation
 * costs a contract rather than the unit, and the bounded share they reserve ahead of the unit's own
 * regions is the one exception to that order. Whatever is lost is reported, because an omitted region
 * is not evidence that the region is safe.
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
    const ownOrder = inFitOrder(set, own, compareOwnOrder);
    const contextOrder = inFitOrder(set, context, compareContextOrder);
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
