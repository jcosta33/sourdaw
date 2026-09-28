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
 */

import { EVIDENCE_SIDES, type EvidenceReference, type EvidenceSide } from './contracts.ts';

import type { SemanticEvidenceSet } from './evidence.ts';

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
 * The exact bytes one region costs inside a request's evidence map.
 *
 * This must be the serialized size, not the raw byte count: JSON escapes every newline in a source
 * file to two bytes, so a raw-byte estimate under-counts by roughly one byte per line and a unit
 * sized by it overruns the request limit.
 */
export function regionCost(reference: EvidenceReference, content: string): number {
    return Buffer.byteLength(JSON.stringify({ [reference.evidenceId]: serializedRegion(reference, content) }), 'utf8');
}

/**
 * One region as the pre-admission measure reads it: the fields every caller holds before admission has
 * minted the rest.
 */
export type RequestRegion = {
    readonly path: string;
    readonly side: EvidenceSide;
    readonly content: string;
};

/**
 * The bytes one region costs the request that carries it, as admission, the planner's "will this file
 * produce a unit" predicate and the ranking charge all read it.
 *
 * Those three have to agree about whether a request can carry a region, and they run at different points:
 * the predicate before admission, the charge during it, admission itself. Only the path, the side and the
 * content are known to all three — admission mints the identifier and derives the bounds, and a whole
 * side and a hunk of it differ in both — so this measure fixes every derived field at its shortest form:
 * the first identifier admission can mint, a sha and a digest of the length every real one has, and the
 * first line's bounds. It is the payload cost up to the few bytes those fields' real values add, and it is
 * the one bound the three share, rather than three approximations that disagree at the ceiling.
 */
export function regionRequestBytes(region: RequestRegion): number {
    return regionCost(
        {
            evidenceId: 'a1',
            revisionSha: '0'.repeat(40),
            path: region.path,
            side: region.side,
            startLine: 1,
            endLine: 1,
            contentHash: '0'.repeat(64),
        },
        region.content
    );
}

/** Whether one region can be carried by a request at all: the one gate admission, the planner predicate and the charge share. */
export function regionFitsRequest(region: RequestRegion, maxRegionBytes: number): boolean {
    return regionRequestBytes(region) <= maxRegionBytes;
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
 * How much of a request's evidence budget contracts may take. Contract files are large and mostly
 * unrelated to any one unit, and the provider documents that unrelated state reduces accuracy, so
 * they get a bounded share ahead of the change's own source rather than whatever is left over —
 * otherwise a whole-file contract never fits and every contract-requiring rule is permanently
 * unresolved.
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
 * A region that does not fit is dropped, counted, and its side recorded, so the questions that
 * needed it report the evidence as not supplied rather than answering over a fragment; later regions
 * are dropped once the budget is gone. Context regions are offered last, so an oversized
 * implementation costs a contract rather than the unit. Whatever is lost is reported, because an
 * omitted region is not evidence that the region is safe.
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
    const contextBudget = context.length === 0 ? 0 : Math.floor(maxBytes * CONTEXT_BUDGET_SHARE);
    const ownFitted = fitRegions(set, own, maxBytes - contextBudget);
    const contextFitted = fitRegions(set, context, maxBytes - ownFitted.used);
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
