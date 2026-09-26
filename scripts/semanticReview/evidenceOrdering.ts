/**
 * The admission order and its byte-cost inputs.
 *
 * The collector reads each changed path's sides once and hands the reads here, so classification,
 * sizing, and admission all consume one read per side. Ordering is over the admission units the
 * collector actually admits — each changed file's before and after side, plus each contract-context
 * region — in the order admission walks them, so a side that carries a contract and the contract
 * documents themselves are admitted before a bulk side of another change whatever the file order, and
 * the class a unit is ordered by is the class its withheld reason names.
 *
 * A side of a path that is contract-carrying on either side outranks a purely bulk side of another
 * path, so a collected spec whose after side imports a closure member keeps its bulk before side ahead
 * of an unrelated bulk competitor: the budget stays on the change the contract lives in. The withheld
 * reason still reads the side's own class, so a bulk after side of a contract-before rename is named
 * without the contract term.
 *
 * The byte figure is an order-independent lower bound, a tie-break inside one class rather than a
 * promise of what each side pays. A region the content screen or the per-region budget withholds costs
 * zero, and a region shared by several changed paths (a copy or rename whose source is also changed) is
 * counted once and charged to whichever claimant admission reaches first; the first claimant can
 * therefore rank below the charge admission applies to it, and a smaller edit is not guaranteed to
 * survive when a region is shared.
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

/** The side of a changed file the collector admits as one unit. */
export type AdmissionSide = 'before' | 'after';

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

/** A changed file's side the collector admits as one unit. */
export type ChangedSideUnit = {
    readonly kind: 'changed';
    readonly file: SemanticChangedFile;
    readonly side: AdmissionSide;
    readonly contractCarrying: boolean;
    /** Whether the path is contract-carrying on either side, so its bulk side still outranks a purely bulk path. */
    readonly pathContractCarrying: boolean;
    readonly admissionBytes: number;
};

/** A contract-context region the collector admits with the contract class. */
export type ContractContextUnit = {
    readonly kind: 'context';
    readonly path: string;
    readonly side: 'context';
    readonly contractCarrying: true;
    readonly pathContractCarrying: true;
    readonly admissionBytes: number;
};

/** One admission unit: a changed file's side or a contract-context region. */
export type AdmissionUnit = ChangedSideUnit | ContractContextUnit;

/** The admission byte figure for one changed path, split by side. */
export type AdmissionSideBytes = { readonly before: number; readonly after: number };

function unitPath(unit: AdmissionUnit): string {
    return unit.kind === 'context' ? unit.path : unit.file.path;
}

function unitSideOrder(unit: AdmissionUnit): number {
    if (unit.side === 'before') {
        return 0;
    }
    if (unit.side === 'after') {
        return 1;
    }
    return 2;
}

/**
 * The admission order. Contract-carrying first — a contract-carrying side and every contract-context
 * region — then, inside each class, non-spec before collected spec, then a side of a contract-carrying
 * path before a purely bulk side, then ascending admission bytes — the order-independent lower bound a
 * side's sole regions cost, a tie-break rather than a promise of what the side pays — then path, then a
 * path's before side before its own after side. No spec can outrank the source it covers, and a
 * whole-file fallback cannot starve a smaller genuine edit; a region shared with another change is still
 * charged to whichever side admits it first, so the byte figure does not promise that every smaller
 * edit survives.
 */
export function compareAdmissionUnits(left: AdmissionUnit, right: AdmissionUnit): number {
    const leftContract = left.contractCarrying ? 0 : 1;
    const rightContract = right.contractCarrying ? 0 : 1;
    if (leftContract !== rightContract) {
        return leftContract - rightContract;
    }
    const leftSpec = isCollectedSpec(unitPath(left)) ? 1 : 0;
    const rightSpec = isCollectedSpec(unitPath(right)) ? 1 : 0;
    if (leftSpec !== rightSpec) {
        return leftSpec - rightSpec;
    }
    const leftPathContract = left.pathContractCarrying ? 0 : 1;
    const rightPathContract = right.pathContractCarrying ? 0 : 1;
    if (leftPathContract !== rightPathContract) {
        return leftPathContract - rightPathContract;
    }
    if (left.admissionBytes !== right.admissionBytes) {
        return left.admissionBytes - right.admissionBytes;
    }
    const byPath = compareLexicographic(unitPath(left), unitPath(right));
    if (byPath !== 0) {
        return byPath;
    }
    return unitSideOrder(left) - unitSideOrder(right);
}

/**
 * The admission units for one change, in admission order. A file contributes its before side first and
 * its after side second; each side is ordered by its own class, so a rename or copy out of a contract
 * surface admits its contract before side before a bulk side of another change while its bulk after
 * side stays ranked with bulk. Contract-context regions join the same ordering as contract class, so
 * they are admitted before bulk changed-file units.
 */
export function admissionUnits(
    changed: readonly SemanticChangedFile[],
    sidesByPath: ReadonlyMap<string, ContractCarryingSides>,
    admissionBytesBySide: ReadonlyMap<string, AdmissionSideBytes>,
    contractContexts: readonly { path: string; admissionBytes: number }[]
): readonly AdmissionUnit[] {
    const units: AdmissionUnit[] = [];
    for (const file of changed) {
        const sides = sidesByPath.get(file.path);
        const pathContractCarrying = (sides?.before ?? false) || (sides?.after ?? false);
        if (kindHasBeforeSide(file.kind)) {
            units.push({
                kind: 'changed',
                file,
                side: 'before',
                contractCarrying: sides?.before ?? false,
                pathContractCarrying,
                admissionBytes: admissionBytesBySide.get(file.path)?.before ?? 0,
            });
        }
        if (kindHasAfterSide(file.kind)) {
            units.push({
                kind: 'changed',
                file,
                side: 'after',
                contractCarrying: sides?.after ?? false,
                pathContractCarrying,
                admissionBytes: admissionBytesBySide.get(file.path)?.after ?? 0,
            });
        }
    }
    for (const context of contractContexts) {
        units.push({
            kind: 'context',
            path: context.path,
            side: 'context',
            contractCarrying: true,
            pathContractCarrying: true,
            admissionBytes: context.admissionBytes,
        });
    }
    return units.sort(compareAdmissionUnits);
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
export function chargeableRegionBytes(raw: string, maxRegionBytes: number): number {
    if (sensitiveContentReason(raw) !== undefined) {
        return 0;
    }
    if (Buffer.byteLength(raw, 'utf8') > maxRegionBytes) {
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
        regions.set(key, { bytes: chargeableRegionBytes(raw, maxRegionBytes), side, paths: new Set([changedPath]) });
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
