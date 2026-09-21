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

import type { EvidenceReference } from './contracts.ts';
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
function regionCost(reference: EvidenceReference, content: string): number {
    return Buffer.byteLength(JSON.stringify({ [reference.evidenceId]: serializedRegion(reference, content) }), 'utf8');
}

/**
 * Fits one unit's regions inside the per-request state budget.
 *
 * A region that does not fit is truncated to a whole-line prefix and re-hashed, so the hash always
 * describes the text actually sent; later regions are dropped once the budget is gone. Context
 * regions are offered last, so an oversized implementation costs a contract rather than the unit.
 * Whatever is lost is reported, because an omitted region is not evidence that the region is safe.
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
} {
    const references: EvidenceReference[] = [];
    const contents = new Map<string, string>();
    let used = 0;
    let dropped = 0;

    for (const reference of candidates) {
        const text = set.contents.get(reference.evidenceId) ?? '';
        const full = regionCost(reference, text);
        if (used + full > maxBytes) {
            dropped += 1;
            continue;
        }
        used += full;
        references.push(reference);
        contents.set(reference.evidenceId, text);
    }
    return { references, contents, used, dropped };
}

/**
 * How much of a request's evidence budget contracts may take. Contract files are large and mostly
 * unrelated to any one unit, and the provider documents that unrelated state reduces accuracy, so
 * they get a bounded share ahead of the change's own source rather than whatever is left over —
 * otherwise a whole-file contract never fits and every contract-requiring rule is permanently
 * unresolved.
 */
const CONTEXT_BUDGET_SHARE = 0.4;

/**
 * Fits one unit's regions inside the per-request state budget.
 *
 * A region that does not fit is truncated to a whole-line prefix and re-hashed, so the hash always
 * describes the text actually sent; later regions are dropped once the budget is gone. Whatever is
 * lost is reported, because an omitted region is not evidence that the region is safe.
 */
export function fitUnitEvidence(
    set: SemanticEvidenceSet,
    own: readonly EvidenceReference[],
    context: readonly EvidenceReference[],
    maxBytes: number
): {
    references: EvidenceReference[];
    contents: Map<string, string>;
    dropped: number;
} {
    const contextBudget = context.length === 0 ? 0 : Math.floor(maxBytes * CONTEXT_BUDGET_SHARE);
    const ownFitted = fitRegions(set, own, maxBytes - contextBudget);
    const contextFitted = fitRegions(set, context, maxBytes - ownFitted.used);
    const contents = new Map<string, string>([...ownFitted.contents, ...contextFitted.contents]);
    return {
        references: [...ownFitted.references, ...contextFitted.references],
        contents,
        dropped: ownFitted.dropped + contextFitted.dropped,
    };
}
