/**
 * What a change's files hold, and what their regions charge the run.
 *
 * The side reads and hunks are shared by classification, sizing and admission, and the byte figure each
 * side ranks by is computed here: one region's chargeable bytes, its side, and the changed paths that
 * mint it. Kept apart from the ordering that consumes the figure, so both stay inside their own ceilings.
 */

import { regionFitsRequest } from './fit.ts';
import { sensitiveContentReason } from './sensitive.ts';
import { sliceLines, splitLines, type LineRange } from './slicing.ts';

import type { EvidenceSide } from './contracts.ts';
import type { PathHunks, SemanticChangedFile, SemanticSourcePort } from './evidence.ts';

/** The side of a changed file the collector admits as one unit. */
export type AdmissionSide = 'before' | 'after';

export type AdmissionSideBytes = { readonly before: number; readonly after: number };

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

/**
 * The raw bytes of one region, or zero when admission cannot charge it: the content screen withholds it,
 * or the request carrying it cannot fit it. The eligibility is the serialized measure admission gates on
 * and the planner's predicate reads — one bound for the three, so they cannot disagree about whether the
 * region can leave — while the figure itself stays raw, because the run's totals are stated in the bytes
 * that leave the machine.
 */
export function chargeableRegionBytes(
    region: { readonly path: string; readonly side: EvidenceSide },
    raw: string,
    maxRegionBytes: number
): number {
    if (sensitiveContentReason(raw) !== undefined || !regionFitsRequest({ ...region, content: raw }, maxRegionBytes)) {
        return 0;
    }
    return Buffer.byteLength(raw, 'utf8');
}

/** The identity admission gives a region: revision, path, side, and clamped bounds. */
function regionKey(revisionSha: string, path: string, side: AdmissionSide, range: LineRange): string {
    return `${revisionSha}:${path}:${side}:${range.startLine}-${range.endLine}`;
}

/** One region's chargeable bytes, its side, and the changed paths that mint it. */
type RegionMint = { readonly bytes: number; readonly side: AdmissionSide; readonly paths: Set<string> };

function recordRegion(
    regions: Map<string, RegionMint>,
    revisionSha: string,
    regionPath: string,
    side: AdmissionSide,
    range: LineRange,
    raw: string,
    maxRegionBytes: number,
    changedPath: string
): void {
    const key = regionKey(revisionSha, regionPath, side, range);
    const mint = regions.get(key);
    if (mint === undefined) {
        regions.set(key, {
            bytes: chargeableRegionBytes({ path: regionPath, side }, raw, maxRegionBytes),
            side,
            paths: new Set([changedPath]),
        });
    } else {
        mint.paths.add(changedPath);
    }
}

/** Records one side's regions: each hunk slice admission can charge, or the whole side when the hunks are unavailable. */
function recordSideRegions(
    regions: Map<string, RegionMint>,
    revisionSha: string,
    regionPath: string,
    side: AdmissionSide,
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
 * Each changed path's admission byte figure, per side, computed once from the shared side reads and
 * hunks.
 *
 * A region's chargeable bytes count toward a side only when that (path, side) is the region's sole
 * minter. A region shared by several paths — a copy or rename whose unchanged source is also changed —
 * is charged once at admission by whichever claimant admits it first, so counting it toward every
 * claimant would rank a derived path by bytes admission will not charge it. The figure is an
 * order-independent lower bound, not a promise of what each side pays: the first claimant of a shared
 * region can rank below the charge admission applies to it, and a smaller edit is not guaranteed to
 * survive when a region is shared.
 */
export function admissionBytesBySide(
    changed: readonly SemanticChangedFile[],
    contents: ReadonlyMap<string, ChangedFileContents>,
    hunksByPath: ReadonlyMap<string, PathHunks>,
    maxRegionBytes: number,
    mergeBaseSha: string,
    headSha: string
): ReadonlyMap<string, AdmissionSideBytes> {
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
    const bytes = new Map<string, AdmissionSideBytes>();
    for (const file of changed) {
        bytes.set(file.path, { before: 0, after: 0 });
    }
    for (const mint of regions.values()) {
        if (mint.paths.size !== 1) {
            continue;
        }
        const owner = mint.paths.values().next().value as string;
        const current = bytes.get(owner) ?? { before: 0, after: 0 };
        bytes.set(owner, {
            before: current.before + (mint.side === 'before' ? mint.bytes : 0),
            after: current.after + (mint.side === 'after' ? mint.bytes : 0),
        });
    }
    return bytes;
}
