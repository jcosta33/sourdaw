/**
 * Preparation of contract-context regions: read each document once, screen it whole, truncate an
 * over-budget document to fitting leading lines, and charge the bytes admission will actually see.
 *
 * A context document is an index read as background, not a side a question is asked about, so an
 * over-budget one is admitted as a marked prefix rather than dropped whole — at local budgets both
 * defaults (the root contract and the decision ledger) exceed the per-region ceiling, and dropping
 * them starved every contract-needing unit of the entire contract context. The content screen runs
 * on the whole document before truncation, so a credential anywhere in it keeps the region withheld
 * whole: a prefix the screen never saw must not become the sent text.
 */

import { chargeableRegionBytes } from './admissionBytes.ts';
import { regionFitsRequest } from './fit.ts';
import { sensitiveContentReason } from './sensitive.ts';
import { splitLines, type LineRange } from './slicing.ts';

/** The scope-exclusion reason a contract-context region admitted as a truncated prefix carries. */
export const CONTEXT_REGION_TRUNCATED_CODE = 'context-region-truncated-to-budget';

/** One truncation the collector must disclose: the path and the limitation line naming what was kept. */
export type ContextTruncation = { readonly path: string; readonly limitation: string };

export type PreparedContractContext = {
    /** The text admission supplies per path — the truncated text where truncation applied. */
    readonly content: ReadonlyMap<string, string>;
    /** The bounds a truncated region keeps, so its reference names the lines it carries. */
    readonly ranges: ReadonlyMap<string, LineRange>;
    readonly truncations: readonly ContextTruncation[];
    /** The per-path chargeable figure the admission ranking orders these documents by. */
    readonly contexts: readonly { path: string; admissionBytes: number }[];
};

/** The closing line a truncated context region carries, so the model can never read it as the whole document. */
function contextTruncationMarker(keptLines: number, totalLines: number): string {
    return `[semantic review: context truncated to the per-region budget: first ${String(keptLines)} of ${String(totalLines)} lines]`;
}

/**
 * The leading whole lines of an over-budget contract-context region, plus a marker naming what was
 * kept, sized by the serialized measure every other gate shares — or `undefined` when not even one
 * line plus its marker fits, in which case the caller keeps the whole-region withhold.
 *
 * Lines are kept from the start because the ledger and the root contract open with the table headers
 * and the rules every later row elaborates.
 */
function truncateContextRegion(
    path: string,
    raw: string,
    maxRegionBytes: number
): { text: string; keptLines: number; totalLines: number } | undefined {
    const lines = splitLines(raw);
    for (let kept = lines.length; kept > 0; kept -= 1) {
        const candidate = `${lines.slice(0, kept).join('\n')}\n${contextTruncationMarker(kept, lines.length)}`;
        if (regionFitsRequest({ path, side: 'context', content: candidate }, maxRegionBytes)) {
            return { text: candidate, keptLines: kept, totalLines: lines.length };
        }
    }
    return undefined;
}

export function prepareContractContext(input: {
    /** The document's text at the contract source revision, or `undefined` when it cannot be read. */
    readonly read: (path: string) => string | undefined;
    readonly paths: ReadonlySet<string>;
    readonly maxRegionBytes: number;
}): PreparedContractContext {
    const content = new Map<string, string>();
    const ranges = new Map<string, LineRange>();
    const truncations: ContextTruncation[] = [];
    const contexts = Array.from(input.paths).map((path) => {
        const raw = input.read(path);
        if (raw === undefined) {
            return { path, admissionBytes: 0 };
        }
        let admitted = raw;
        if (
            sensitiveContentReason(raw) === undefined &&
            !regionFitsRequest({ path, side: 'context', content: raw }, input.maxRegionBytes)
        ) {
            const truncated = truncateContextRegion(path, raw, input.maxRegionBytes);
            if (truncated !== undefined) {
                admitted = truncated.text;
                ranges.set(path, { startLine: 1, endLine: truncated.keptLines });
                truncations.push({
                    path,
                    limitation: `contract ${path} was supplied truncated to its first ${String(truncated.keptLines)} of ${String(truncated.totalLines)} lines: it exceeds the per-region budget`,
                });
            }
        }
        content.set(path, admitted);
        return {
            path,
            admissionBytes: chargeableRegionBytes({ path, side: 'context' }, admitted, input.maxRegionBytes),
        };
    });
    return { content, ranges, truncations, contexts };
}
