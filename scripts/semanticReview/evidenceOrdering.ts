/**
 * The admission order and its byte-cost inputs.
 *
 * The collector reads each changed path's sides once and hands the reads here, so classification,
 * sizing, and admission all consume one read per side. Ordering by the bytes a path's regions cost at
 * admission — rather than by its changed-line total — keeps a zero-line copy or a whole-file fallback
 * from outranking a smaller genuine edit.
 */

import { isCollectedSpec } from './rules.ts';
import { sliceLines, type LineRange } from './slicing.ts';

import type { PathHunks, SemanticChangedFile, SemanticSourcePort } from './evidence.ts';

/** A deterministic string ordering. `localeCompare` is locale-dependent and would not be reproducible. */
export function compareLexicographic(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}

/** A deterministic path ordering, used wherever a source ordering must be reproducible. */
export function compareByPath(left: { readonly path: string }, right: { readonly path: string }): number {
    return compareLexicographic(left.path, right.path);
}

/**
 * The admission order for one change. Contract-carrying before bulk, and inside each group non-spec
 * before collected spec, then ascending admission bytes — the bytes a path's regions cost at admission
 * — then path, so no spec can outrank the source it covers and a whole-file fallback cannot starve a
 * smaller genuine edit.
 */
export function compareForAdmission(
    left: SemanticChangedFile,
    right: SemanticChangedFile,
    contractCarrying: ReadonlySet<string>,
    admissionBytesByPath: ReadonlyMap<string, number>
): number {
    const leftContract = contractCarrying.has(left.path) ? 0 : 1;
    const rightContract = contractCarrying.has(right.path) ? 0 : 1;
    if (leftContract !== rightContract) {
        return leftContract - rightContract;
    }
    const leftSpec = isCollectedSpec(left.path) ? 1 : 0;
    const rightSpec = isCollectedSpec(right.path) ? 1 : 0;
    if (leftSpec !== rightSpec) {
        return leftSpec - rightSpec;
    }
    const leftBytes = admissionBytesByPath.get(left.path) ?? 0;
    const rightBytes = admissionBytesByPath.get(right.path) ?? 0;
    if (leftBytes !== rightBytes) {
        return leftBytes - rightBytes;
    }
    return compareByPath(left, right);
}

/** The before and after side contents of one changed file, read once and reused for classification, sizing, and admission. */
export type ChangedFileContents = {
    readonly before?: string;
    readonly after?: string;
};

/** Whether a change kind has a before side at the merge base; a copy's unchanged source is one. */
export function kindHasBeforeSide(kind: SemanticChangedFile['kind']): boolean {
    return kind === 'modified' || kind === 'renamed' || kind === 'deleted' || kind === 'copied';
}

/** Whether a change kind has an after side at the reviewed head; a copy's new destination is one. */
export function kindHasAfterSide(kind: SemanticChangedFile['kind']): boolean {
    return kind === 'added' || kind === 'modified' || kind === 'renamed' || kind === 'copied';
}

/** Reads each changed path's sides once, so classification, sizing, and admission share the same read. */
export function readChangedContents(
    port: SemanticSourcePort,
    mergeBaseSha: string,
    headSha: string,
    changed: readonly SemanticChangedFile[]
): ReadonlyMap<string, ChangedFileContents> {
    const contents = new Map<string, ChangedFileContents>();
    for (const file of changed) {
        const beforePath = file.previousPath ?? file.path;
        const entry: { before?: string; after?: string } = {};
        if (kindHasBeforeSide(file.kind)) {
            entry.before = port.readFile(mergeBaseSha, beforePath);
        }
        if (kindHasAfterSide(file.kind)) {
            entry.after = port.readFile(headSha, file.path);
        }
        contents.set(file.path, entry);
    }
    return contents;
}

/** The raw bytes of one side's regions: each hunk slice, or the whole side when the hunks are unavailable. */
function sideRegionBytes(raw: string, ranges: readonly LineRange[] | undefined): number {
    if (ranges === undefined || ranges.length === 0) {
        return Buffer.byteLength(raw, 'utf8');
    }
    let bytes = 0;
    for (const range of ranges) {
        const sliced = sliceLines(raw, range);
        if (sliced !== undefined) {
            bytes += Buffer.byteLength(sliced.text, 'utf8');
        }
    }
    return bytes;
}

/** Each changed path's admission byte cost, computed once from the shared side reads and hunks. */
export function admissionBytesByPath(
    changed: readonly SemanticChangedFile[],
    contents: ReadonlyMap<string, ChangedFileContents>,
    hunksByPath: ReadonlyMap<string, PathHunks>
): ReadonlyMap<string, number> {
    const bytes = new Map<string, number>();
    for (const file of changed) {
        const entry = contents.get(file.path);
        const hunks = hunksByPath.get(file.path);
        let total = 0;
        if (kindHasBeforeSide(file.kind) && entry?.before !== undefined) {
            total += sideRegionBytes(entry.before, hunks?.before);
        }
        if (kindHasAfterSide(file.kind) && entry?.after !== undefined) {
            total += sideRegionBytes(entry.after, hunks?.after);
        }
        bytes.set(file.path, total);
    }
    return bytes;
}
