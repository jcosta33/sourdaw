/**
 * The admission order and its byte-cost inputs.
 *
 * The collector reads each changed path's sides once and hands the reads here, so classification,
 * sizing, and admission all consume one read per side. Ordering is by the side that represents the
 * change — the after side when it exists, the before side for a deletion — so a path is ranked and
 * labelled by one classification. The byte cost is what admission can actually charge: a region the
 * content screen or the per-region budget withholds costs zero, and a region shared by several changed
 * paths (a copy or rename whose source is also changed) is counted once, so a derived path is not
 * ranked by bytes admission will not charge it.
 */

import { isContractCarryingContent } from './contractCarrying.ts';
import { isCollectedSpec } from './rules.ts';
import { sensitiveContentReason } from './sensitive.ts';
import { sliceLines, splitLines, type LineRange } from './slicing.ts';

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

/** The contract-carrying classification of one changed path's two sides, decided per side from that side's own path and content. */
export type ContractCarryingSides = { readonly before: boolean; readonly after: boolean };

/**
 * Classifies each changed path's sides from the path and content the side itself carries: the
 * pre-change path's before content for the before side, and the post-change path's after content for
 * the after side. A deleted or moved collected spec whose before side pins a closure member therefore
 * still classifies contract-carrying even though its after side is absent or unclassified.
 */
export function classifyContractCarryingSides(
    changed: readonly SemanticChangedFile[],
    contents: ReadonlyMap<string, ChangedFileContents>
): ReadonlyMap<string, ContractCarryingSides> {
    const sidesByPath = new Map<string, ContractCarryingSides>();
    for (const file of changed) {
        const beforePath = file.previousPath ?? file.path;
        const entry = contents.get(file.path);
        const before = entry?.before;
        const after = entry?.after;
        sidesByPath.set(file.path, {
            before: before !== undefined && isContractCarryingContent(beforePath, before),
            after: after !== undefined && isContractCarryingContent(file.path, after),
        });
    }
    return sidesByPath;
}

/** The side whose class orders a path: the after side when it exists, the before side for a deletion. */
function orderingSideClass(file: SemanticChangedFile, sides: ContractCarryingSides | undefined): boolean {
    if (sides === undefined) {
        return false;
    }
    return kindHasAfterSide(file.kind) ? sides.after : sides.before;
}

/**
 * The changed paths that are contract-carrying on the side that represents the change, for the
 * admission order. A path is ordered by that one side's class, never by the union of its two sides, so
 * a rename out of a contract document is not ordered as contract when only its before side is.
 */
export function contractCarryingPaths(
    changed: readonly SemanticChangedFile[],
    sidesByPath: ReadonlyMap<string, ContractCarryingSides>
): ReadonlySet<string> {
    const contractCarrying = new Set<string>();
    for (const file of changed) {
        if (orderingSideClass(file, sidesByPath.get(file.path))) {
            contractCarrying.add(file.path);
        }
    }
    return contractCarrying;
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

/** The raw bytes of one region, or zero when admission cannot charge it: the content screen or the per-region budget withholds it. */
function chargeableRegionBytes(raw: string, maxRegionBytes: number): number {
    if (sensitiveContentReason(raw) !== undefined) {
        return 0;
    }
    if (Buffer.byteLength(raw, 'utf8') > maxRegionBytes) {
        return 0;
    }
    return Buffer.byteLength(raw, 'utf8');
}

/** The identity admission gives a region: revision, path, side, and clamped bounds. */
function regionKey(revisionSha: string, path: string, side: 'before' | 'after', range: LineRange): string {
    return `${revisionSha}:${path}:${side}:${range.startLine}-${range.endLine}`;
}

/** One region's chargeable bytes and the changed paths that mint it. */
type RegionMint = { readonly bytes: number; readonly paths: Set<string> };

function recordRegion(
    regions: Map<string, RegionMint>,
    revisionSha: string,
    regionPath: string,
    side: 'before' | 'after',
    range: LineRange,
    raw: string,
    maxRegionBytes: number,
    changedPath: string
): void {
    const key = regionKey(revisionSha, regionPath, side, range);
    const mint = regions.get(key);
    if (mint === undefined) {
        regions.set(key, { bytes: chargeableRegionBytes(raw, maxRegionBytes), paths: new Set([changedPath]) });
    } else {
        mint.paths.add(changedPath);
    }
}

/** Records one side's regions: each hunk slice admission can charge, or the whole side when the hunks are unavailable. */
function recordSideRegions(
    regions: Map<string, RegionMint>,
    revisionSha: string,
    regionPath: string,
    side: 'before' | 'after',
    raw: string,
    ranges: readonly LineRange[] | undefined,
    maxRegionBytes: number,
    changedPath: string
): void {
    if (ranges === undefined || ranges.length === 0) {
        recordRegion(
            regions,
            revisionSha,
            regionPath,
            side,
            { startLine: 1, endLine: Math.max(1, splitLines(raw).length) },
            raw,
            maxRegionBytes,
            changedPath
        );
        return;
    }
    for (const range of ranges) {
        const sliced = sliceLines(raw, range);
        if (sliced === undefined) {
            continue;
        }
        recordRegion(regions, revisionSha, regionPath, side, sliced.range, sliced.text, maxRegionBytes, changedPath);
    }
}

/**
 * Each changed path's admission byte cost, computed once from the shared side reads and hunks.
 *
 * A region's chargeable bytes count toward a path only when that path is the region's sole minter. A
 * region shared by several paths — a copy or rename whose unchanged source is also changed — is charged
 * once at admission by whichever path admits it first, so counting it toward every path would rank a
 * derived path by bytes admission will not charge it. The figure is a pure function of the change, so
 * it neither depends on which path is admitted first nor exceeds what admission can charge the path.
 */
export function admissionBytesByPath(
    changed: readonly SemanticChangedFile[],
    contents: ReadonlyMap<string, ChangedFileContents>,
    hunksByPath: ReadonlyMap<string, PathHunks>,
    maxRegionBytes: number,
    mergeBaseSha: string,
    headSha: string
): ReadonlyMap<string, number> {
    const regions = new Map<string, RegionMint>();
    for (const file of changed) {
        const entry = contents.get(file.path);
        const hunks = hunksByPath.get(file.path);
        if (kindHasBeforeSide(file.kind) && entry?.before !== undefined) {
            recordSideRegions(
                regions,
                mergeBaseSha,
                file.previousPath ?? file.path,
                'before',
                entry.before,
                hunks?.before,
                maxRegionBytes,
                file.path
            );
        }
        if (kindHasAfterSide(file.kind) && entry?.after !== undefined) {
            recordSideRegions(
                regions,
                headSha,
                file.path,
                'after',
                entry.after,
                hunks?.after,
                maxRegionBytes,
                file.path
            );
        }
    }
    const bytes = new Map<string, number>();
    for (const file of changed) {
        bytes.set(file.path, 0);
    }
    for (const mint of regions.values()) {
        if (mint.paths.size !== 1) {
            continue;
        }
        const owner = mint.paths.values().next().value as string;
        bytes.set(owner, (bytes.get(owner) ?? 0) + mint.bytes);
    }
    return bytes;
}
