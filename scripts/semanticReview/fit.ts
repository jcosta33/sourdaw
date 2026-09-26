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
import { type SemanticEvidenceSet } from './evidence.ts';

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
 * How much of a request's evidence budget contracts may take — and only when they can take it at all.
 * Contract files are large and mostly unrelated to any one unit, and the provider documents that
 * unrelated state reduces accuracy, so an admitted contract region that fits this share is reserved
 * ahead of the change's own source rather than left to whatever is left over.
 *
 * The reserve is taken only for a context region the request can actually carry, because a reserved
 * share no region fits buys nothing and costs the unit its own evidence. Measured against the real
 * default documents on a contract-needing `src/modules/Project` unit, the share is 4,401 B of the local
 * profile's 11,003 B request budget and 7,678 B of the ci profile's 19,195 B, while
 * `.agents/decisions/README.md` costs 11,981 B serialized and `AGENTS.md` is over the per-region
 * ceiling at both profiles. Neither profile therefore reserves anything for the README: local cannot
 * carry it at all and withholds it while the unit's own sides keep the budget, and ci sends it only out
 * of the 14,874 B the unit's own sides leave there.
 */
const CONTEXT_BUDGET_SHARE = 0.4;

/**
 * Whether an offered context region fits the bounded share, so reserving it delivers a document the
 * request can carry. A region larger than the share is not necessarily lost — the context fit still
 * receives whatever the own sides leave — but the reserve cannot be what admits it.
 */
function contextShareFits(set: SemanticEvidenceSet, context: readonly EvidenceReference[], share: number): boolean {
    return context.some((reference) => regionCost(reference, set.contents.get(reference.evidenceId) ?? '') <= share);
}

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
 * implementation costs a contract rather than the unit — except for the bounded share
 * `contextShareFits` reserves when a context region fits it. Whatever is lost is reported, because an
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
    const share = Math.floor(maxBytes * CONTEXT_BUDGET_SHARE);
    const contextBudget = contextShareFits(set, context, share) ? share : 0;
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
 * in the fixed side order so a reader can tell which side was cut; a unit reduced only by a collector
 * withholding carries no fitted drop and keeps the plain reason.
 */
export function unitReductionReason(dropped: ReadonlySet<EvidenceSide>): string {
    const sides = [...dropped].sort((left, right) => EVIDENCE_SIDES.indexOf(left) - EVIDENCE_SIDES.indexOf(right));
    if (sides.length === 0) {
        return 'unit-evidence-reduced-below-request-budget';
    }
    return `unit-evidence-reduced-below-request-budget (${sides.join(', ')})`;
}
