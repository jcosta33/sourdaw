/**
 * The admission order and its byte-cost inputs.
 *
 * The collector reads each changed path's sides once and hands the reads here, so classification,
 * sizing, and admission all consume one read per side. Ordering is over the admission units the
 * collector actually admits — each changed file's before and after side, plus each contract-context
 * region — in the order admission walks them, in four tiers:
 *
 * 1. the change's own contract-carrying sides — the changed-file before/after units whose side is
 *    contract-carrying, or a source a contract-carrying spec covers when that source's unit will be
 *    planned — so the budget stays on the change the contract lives in and no spec outranks the source
 *    it covers. A covered source is ordered at the smaller of its own side figure and the covering spec's
 *    figure rather than at the front of the tier, so the source keeps the room its own size earned, still
 *    precedes its own spec, and never outranks contract material unrelated to that spec;
 * 2. a changed file whose unit the planner will plan and whose rules need contract evidence — its own
 *    sides, attempted before the context units those rules charge, while the side stays behind genuine
 *    contract material. The attempt order is what keeps the charge from taking its reader's place at
 *    admission: when the collector's total binds before the context tier, the document is withheld
 *    there and no contract-context region reaches the request fitter at all, so the request budget is
 *    spent on the own sides the collector admitted. A file that plans no unit is never promoted here —
 *    it charges nothing, and its sides keep the rank their own class gives them, so a contract-carrying
 *    side still holds the first tier. The request fitter reserves `CONTEXT_BUDGET_SHARE` of the request
 *    for the context whenever the unit carries any, so a unit's own sides can still be withheld below
 *    its request;
 * 3. contract-context units, the documents read at the contract source revision — ahead of bulk,
 *    behind the change's own contract material;
 * 4. bulk sides of the change.
 *
 * A side of a path that is contract-carrying on either side outranks a purely bulk side of another
 * path, so a collected spec whose after side imports a closure member keeps its bulk before side ahead
 * of an unrelated bulk competitor. The withheld reason still reads the side's own class, so a bulk after
 * side of a contract-before rename is named without the contract term, while a contract-context region
 * keeps its `contractCarrying` labelling and its `(context, contract)` withheld reason.
 *
 * The byte figure is an order-independent lower bound, a tie-break inside one tier rather than a
 * promise of what each side pays. A region the content screen or the per-region budget withholds costs
 * zero, and a region shared by several changed paths (a copy or rename whose source is also changed) is
 * counted once and charged to whichever claimant admission reaches first; the first claimant can
 * therefore rank below the charge admission applies to it, and a smaller edit is not guaranteed to
 * survive when a region is shared. The same holds when the total binds: a shared-region or
 * contract-context unit still loses its region to the total budget, because the byte figure does not
 * promise which unit the total charges.
 */

import { isContractCarryingContent, resolvedRelativeImportCandidates } from './contractCarrying.ts';
import { applicableRules, isCollectedSpec, unitNeedsContractContext } from './rules.ts';
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

/**
 * The changed paths whose rules declare a contract, decision or registration token. A file's own sides
 * are attempted ahead of the context documents its rules charge, so the order keeps the charge from
 * taking the reader's place — and that is what it keeps: the order decides which side the collector's
 * total withholds and the order in which each unit's own and context regions are attempted, because the
 * request fitter walks them in the order admission handed them over and spends the unit's budget
 * first-come. A priority change can therefore move which region fits at a byte boundary, and a unit
 * sitting on that boundary carries a different set of regions without its admitted set changing; the
 * carriage of a request is not independent of the order. When the total binds before the context tier
 * the contract document is withheld at admission, no contract-context region reaches the request fitter
 * at all, and the fitter's context reserve has nothing to hold.
 *
 * This is the rules-level question alone. Whether the file's unit will exist is `plannedUnitPaths`,
 * and the two consumers that act on a yes — the charge of the default contract documents and this
 * file's tier-1 promotion in `admissionUnits` — ask both. The request fitter's reserve is not among
 * them: it is keyed on the context the unit carries, never on this question.
 */
export function contractNeedingPaths(changed: readonly SemanticChangedFile[]): ReadonlySet<string> {
    const needing = new Set<string>();
    for (const file of changed) {
        const rules = applicableRules(file.previousPath === undefined ? [file.path] : [file.path, file.previousPath]);
        if (unitNeedsContractContext(rules)) {
            needing.add(file.path);
        }
    }
    return needing;
}

/**
 * The slices admission mints for one side: each hunk slice, or the whole side when the hunks were
 * unavailable. The content screen and the planned-unit predicate both read a side through this walk,
 * so one definition keeps them from disagreeing about which parts of a side admission sees.
 *
 * One disagreement survives, in one direction. A hunk range that names lines the revision does not
 * hold slices to nothing here, so this walk reads only the remaining hunks, while `admitSide` screens
 * the side's whole content for that same hunk (`withholdCredentialShapedSide`) and withholds the side.
 * A side credentialed only in the missing range is therefore recorded as withheld for the whole side,
 * without a scope exclusion — the slices this walk does see may still leave — while
 * `credentialShapedPaths`, which reads this walk, counts it clean. The planned-unit gate therefore keeps
 * that unit and still charges the contract documents. No credential-shaped text leaves either way:
 * admission withholds the side whatever this walk saw, and the two agree on every side whose hunks all
 * slice.
 */
function sideSlices(raw: string, ranges: readonly LineRange[] | undefined): string[] {
    if (ranges === undefined || ranges.length === 0) {
        return [raw];
    }
    const slices: string[] = [];
    for (const range of ranges) {
        const sliced = sliceLines(raw, range);
        if (sliced !== undefined) {
            slices.push(sliced.text);
        }
    }
    return slices;
}

/**
 * The changed paths whose unit the planner will plan, read before admission from the criteria the
 * planner applies: the file's own path survives the content screen, its rules admit it, and at least
 * one side the change kind offers holds a slice within the per-region ceiling, which is a region
 * admission will mint for it. A side of zero bytes is such a slice — an emptied modification's empty
 * after side, or a copy of an empty source's before side, mints a region whose content is empty, and
 * the planner plans the unit from it — so the existence test is the slice, never the byte figure that
 * ranks it.
 *
 * This is a pre-admission proxy for "this file will produce a unit", not a promise that a request
 * carries it. Admission cannot know a unit's serialized request budget — its questions, its wrapper,
 * and the JSON escaping of its regions — so a file whose every region exceeds that budget is planned
 * here and excluded later by `planUnits` as `no-evidence-region-within-budget`, leaving the contract
 * document it charged read by nothing. The predicate deliberately does not try to predict the request
 * fitter.
 *
 * One predicate, because three consumers share it and each holds only a projection of this answer: it
 * gates the charge of the default contract documents, the tier-1 promotion of a contract-needing file,
 * and the tier-0 promotion of a source a contract-carrying spec covers. It gates nothing else. A side
 * contract-carrying by its own path and content keeps tier 0 by that classification, whatever this
 * predicate says, and the request fitter's reserve is keyed on whether the unit carries any context
 * region, never on this answer. The own path decides, exactly as the planner's skip does: a rename
 * credentialed on its previous side alone still plans a destination unit from its clean after side, so
 * it is planned here too, while a rename credentialed on both sides is keyed on its own path by
 * `credentialShapedPaths` and plans nothing.
 */
export function plannedUnitPaths(
    changed: readonly SemanticChangedFile[],
    contents: ReadonlyMap<string, ChangedFileContents>,
    hunksByPath: ReadonlyMap<string, PathHunks>,
    maxRegionBytes: number,
    credentialExcludedPaths: ReadonlySet<string>
): ReadonlySet<string> {
    const planned = new Set<string>();
    const sideMintsARegion = (raw: string | undefined, ranges: readonly LineRange[] | undefined): boolean =>
        raw !== undefined && sideSlices(raw, ranges).some((text) => Buffer.byteLength(text, 'utf8') <= maxRegionBytes);
    for (const file of changed) {
        if (credentialExcludedPaths.has(file.path)) {
            continue;
        }
        const offeredPaths = file.previousPath === undefined ? [file.path] : [file.path, file.previousPath];
        if (applicableRules(offeredPaths).length === 0) {
            continue;
        }
        const entry = contents.get(file.path);
        const hunks = hunksByPath.get(file.path);
        const admissible =
            (kindHasBeforeSide(file.kind) && sideMintsARegion(entry?.before, hunks?.before)) ||
            (kindHasAfterSide(file.kind) && sideMintsARegion(entry?.after, hunks?.after));
        if (!admissible) {
            continue;
        }
        planned.add(file.path);
    }
    return planned;
}

/**
 * The changed non-spec sources a changed collected spec covers, each mapped to the covering spec whose own
 * unit ranks first. A spec covers the files it imports and therefore tests, plus one transitive level: the
 * changed files those sources themselves re-export or import. A contract-carrying spec must not outrank the
 * source it covers, so the source is ordered at the covering spec's position when its unit will be planned;
 * a source no spec covers stays bulk whatever its own content imports.
 *
 * The covering spec is a carrier, not a rank: it is what lets a covered source be ordered *with* the spec
 * rather than at the front of the contract tier, so the source competes with unrelated material at the
 * position the spec already held. A source several specs cover is recorded against the covering spec whose
 * own unit ranks first — the smallest side figure the spec carries, then the lexicographically first path —
 * so the source is capped at the earliest side any coverer carries and stays ahead of every spec that covers
 * it, and the answer does not depend on the order the change lists its files in.
 *
 * The transitive level exists because a spec reaches a module it actually tests through a re-export: a
 * spec that imports `evidence.ts` also covers `contractCarrying.ts` and `evidenceOrdering.ts` through
 * `evidence.ts`'s re-exports, and resolving only the spec's own specifiers left those two modules bulk.
 * One level is the observed shape; the closure is not chased further so the walk stays deterministic
 * and cheap over already-read contents.
 */
export function specCoveredSources(
    changed: readonly SemanticChangedFile[],
    contents: ReadonlyMap<string, ChangedFileContents>,
    admissionBytesBySide: ReadonlyMap<string, AdmissionSideBytes>
): ReadonlyMap<string, string> {
    const changedPaths = new Set(changed.map((file) => file.path));
    const filesByPath = new Map(changed.map((file) => [file.path, file]));
    const covered = new Map<string, string>();
    // The covering spec whose own position ranks first under the comparator's keys: the smallest side figure
    // the spec's own unit carries, then the lexicographically first path. The comparator ranks a pair by the
    // collected-spec rank, the contract-carrying class, the byte figure, then the path, and every coverer
    // ties on the first two, so the byte figure and path are what order the coverers.
    const ranksBefore = (candidate: string, incumbent: string): boolean => {
        const candidateFile = filesByPath.get(candidate);
        const incumbentFile = filesByPath.get(incumbent);
        if (candidateFile === undefined || incumbentFile === undefined) {
            return false;
        }
        const candidateBytes = coveringSpecRankBytes(candidateFile.kind, admissionBytesBySide.get(candidate));
        const incumbentBytes = coveringSpecRankBytes(incumbentFile.kind, admissionBytesBySide.get(incumbent));
        if (candidateBytes !== incumbentBytes) {
            return candidateBytes < incumbentBytes;
        }
        return compareLexicographic(candidate, incumbent) < 0;
    };
    const record = (specPath: string, sourcePath: string): void => {
        const existing = covered.get(sourcePath);
        if (existing === undefined || ranksBefore(specPath, existing)) {
            covered.set(sourcePath, specPath);
        }
    };
    const collect = (sourcePath: string, content: string, specPath: string): void => {
        for (const candidate of resolvedRelativeImportCandidates(content, sourcePath)) {
            if (changedPaths.has(candidate) && !isCollectedSpec(candidate)) {
                record(specPath, candidate);
            }
        }
    };
    for (const file of changed) {
        if (!isCollectedSpec(file.path)) {
            continue;
        }
        const entry = contents.get(file.path);
        const beforePath = file.previousPath ?? file.path;
        const before = entry?.before;
        const after = entry?.after;
        const contractByContent =
            (before !== undefined && isContractCarryingContent(beforePath, before)) ||
            (after !== undefined && isContractCarryingContent(file.path, after));
        if (!contractByContent) {
            continue;
        }
        if (before !== undefined) {
            collect(beforePath, before, file.path);
        }
        if (after !== undefined) {
            collect(file.path, after, file.path);
        }
    }
    // One transitive level: each covered source's own re-exports and imports are the material the spec that
    // covers it reaches through it. The snapshot keeps the walk to exactly one level rather than a full
    // closure.
    for (const [coveredPath, specPath] of [...covered]) {
        const file = filesByPath.get(coveredPath);
        if (file === undefined) {
            continue;
        }
        const entry = contents.get(coveredPath);
        const beforePath = file.previousPath ?? file.path;
        if (entry?.before !== undefined) {
            collect(beforePath, entry.before, specPath);
        }
        if (entry?.after !== undefined) {
            collect(file.path, entry.after, specPath);
        }
    }
    return covered;
}

/**
 * The byte figure a covering spec ranks by when several specs cover one source: the smallest of the side
 * figures the spec's own unit carries, so the covered source is capped at the earliest side any coverer
 * carries. Every change kind offers at least one side, so at least one figure is finite.
 */
function coveringSpecRankBytes(kind: SemanticChangedFile['kind'], bytes: AdmissionSideBytes | undefined): number {
    const figures = bytes ?? { before: 0, after: 0 };
    const before = kindHasBeforeSide(kind) ? figures.before : Number.POSITIVE_INFINITY;
    const after = kindHasAfterSide(kind) ? figures.after : Number.POSITIVE_INFINITY;
    return Math.min(before, after);
}

/**
 * The ordering position one admission unit takes inside its tier: the keys the tier's tie-breaks read.
 *
 * A source a contract-carrying spec covers takes the covering spec's position rather than its own, so the
 * pair sits together — the same collected-spec rank and the same contract-carrying classification — and the
 * pair competes with the rest of the tier by the keys the spec already had. The position's byte figure is
 * the smaller of the source's own side figure and the covering spec's own figure: a source smaller than its
 * spec keeps the room its own size earned, while a larger source is capped at the spec's figure, so the
 * source never outranks unrelated material the spec itself does not outrank. `pairRank` is the one key the
 * pair does not share: inside a position nothing else separates a covered source from the spec that covers
 * it, so the covered source (0) orders immediately ahead of its spec (1), which is the one ordering the
 * promotion exists to give. The own figure is also kept beside the capped figure, so several sources capped
 * to one spec's figure keep their own size order rather than collapsing onto a single key.
 */
export type AdmissionOrderPosition = {
    /** The path the in-tier collected-spec tie-break and the path tie-break read. */
    readonly path: string;
    /** Whether the position ranks as a contract-carrying path, so a covered source never outranks genuine contract material. */
    readonly pathContractCarrying: boolean;
    /** The position's byte figure — the smaller of the source's own side figure and the covering spec's figure for a covered source. */
    readonly admissionBytes: number;
    /** The source's own side figure, uncapped — the tie-break that keeps collapsed covered sources in their own size order. */
    readonly ownBytes: number;
    /** The member of a covering pair: 0 for the source a spec covers, 1 for the spec and for every unit outside a pair. */
    readonly pairRank: number;
};

/** A changed file's side the collector admits as one unit. */
export type ChangedSideUnit = {
    readonly kind: 'changed';
    readonly file: SemanticChangedFile;
    readonly side: AdmissionSide;
    readonly contractCarrying: boolean;
    /** Whether a contract-carrying collected spec covers this source, so it ranks in the contract tier once its unit will be planned. */
    readonly specCovered: boolean;
    /** Whether this path's unit will be planned and its rules declare a contract, decision or registration token, so its own sides rank ahead of the context they charge. */
    readonly contractNeeding: boolean;
    /** The position this unit is ordered at: the covering spec's for a covered source, else its own. */
    readonly order: AdmissionOrderPosition;
};

/** A contract-context region the collector admits with the contract class. */
export type ContractContextUnit = {
    readonly kind: 'context';
    readonly path: string;
    readonly side: 'context';
    readonly contractCarrying: true;
    /** A context document is contract material read at its own path, so it is always its own position. */
    readonly order: AdmissionOrderPosition;
};

/** One admission unit: a changed file's side or a contract-context region. */
export type AdmissionUnit = ChangedSideUnit | ContractContextUnit;

/** The admission byte figure for one changed path, split by side. */
export type AdmissionSideBytes = { readonly before: number; readonly after: number };

function unitOwnPath(unit: AdmissionUnit): string {
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
 * The admission tier, four ranks:
 *
 * 0. the change's own contract-carrying sides, and the sources a contract-carrying spec covers when
 *    their own unit will be planned — a covered source inside that rank takes the covering spec's own
 *    position, so it precedes its own spec without outranking unrelated contract material;
 * 1. a changed file whose unit the planner will plan and whose rules declare a contract, decision or
 *    registration token — its own before/after sides are attempted ahead of the context documents
 *    those rules charge, while the side stays behind genuine contract material. A file that plans no
 *    unit is not promoted here: it cannot take the admission order from the documents a planned
 *    reader charged, while a side contract-carrying by its own classification holds tier 0 whatever
 *    the predicate says. The tier is an attempt order, not a protection: it orders what the
 *    collector's total withholds, and the request fitter reserves the bounded context share whenever
 *    the unit carries context, so a contract document the collector withheld under a binding total
 *    costs the fitter nothing and the request budget is spent on the own sides the collector admitted;
 * 2. contract-context units;
 * 3. bulk sides.
 *
 * A side that is contract-carrying keeps rank 0 by that classification whatever the predicate says,
 * even when its file's rules also need contract evidence, so a spec rewritten to drop its closure
 * import still admits its contract before side ahead of its now-contract-needing bulk after side.
 */
function admissionTier(unit: AdmissionUnit): number {
    if (unit.kind === 'context') {
        return 2;
    }
    if (unit.contractCarrying || unit.specCovered) {
        return 0;
    }
    if (unit.contractNeeding) {
        return 1;
    }
    return 3;
}

/**
 * The admission order. Four tiers — the change's own contract-carrying sides first, then a planned
 * contract-needing file's own sides, then contract-context regions, then bulk sides — and, inside each
 * tier, non-spec before collected spec, then a side of a contract-carrying path before a purely bulk
 * side, then ascending admission bytes — the order-independent lower bound a side's sole regions cost,
 * a tie-break rather than a promise of what the side pays — then path, then the pair rank, then the unit's
 * own path, then a path's before side before its own after side. A source a contract-carrying spec covers
 * is ordered at the smaller of its own side figure and the covering spec's figure once its unit will be
 * planned, so the source keeps the room its own size earned and the pair rank alone keeps it ahead of its
 * own spec; a file no spec covers keeps its own position, and a covered source the planner will not plan
 * keeps the rank its own classification gives it. The ascending-byte order is a lower-bound tie-break, not a
 * promise that a smaller side survives — a region shared with another change is charged to whichever side
 * admits it first, and a whole-file fallback can still starve a smaller edit when the total budget binds.
 */
export function compareAdmissionUnits(left: AdmissionUnit, right: AdmissionUnit): number {
    const leftTier = admissionTier(left);
    const rightTier = admissionTier(right);
    if (leftTier !== rightTier) {
        return leftTier - rightTier;
    }
    const leftSpec = isCollectedSpec(left.order.path) ? 1 : 0;
    const rightSpec = isCollectedSpec(right.order.path) ? 1 : 0;
    if (leftSpec !== rightSpec) {
        return leftSpec - rightSpec;
    }
    const leftOrderContract = left.order.pathContractCarrying ? 0 : 1;
    const rightOrderContract = right.order.pathContractCarrying ? 0 : 1;
    if (leftOrderContract !== rightOrderContract) {
        return leftOrderContract - rightOrderContract;
    }
    if (left.order.admissionBytes !== right.order.admissionBytes) {
        return left.order.admissionBytes - right.order.admissionBytes;
    }
    const byOrderPath = compareLexicographic(left.order.path, right.order.path);
    if (byOrderPath !== 0) {
        return byOrderPath;
    }
    // One position, so the units sharing it are a covered source and the spec that covers it, or the two
    // sides of one path: the pair rank keeps the source ahead of its spec, and the own figure keeps several
    // sources capped to one spec's figure in their own size order rather than collapsing onto one key.
    if (left.order.pairRank !== right.order.pairRank) {
        return left.order.pairRank - right.order.pairRank;
    }
    if (left.order.ownBytes !== right.order.ownBytes) {
        return left.order.ownBytes - right.order.ownBytes;
    }
    const byOwnPath = compareLexicographic(unitOwnPath(left), unitOwnPath(right));
    if (byOwnPath !== 0) {
        return byOwnPath;
    }
    return unitSideOrder(left) - unitSideOrder(right);
}

/**
 * The admission units for one change, in admission order. A file contributes its before side first and
 * its after side second; each side is ordered by its own class, so a rename or copy out of a contract
 * surface admits its contract before side before a bulk side of another change while its bulk after
 * side stays ranked with bulk. A source a contract-carrying spec covers is ordered at the covering
 * spec's position, so it precedes the spec that covers it and no other collected spec. Contract-context
 * regions sit in their own tier — behind the change's own contract-carrying sides, ahead of bulk — so a
 * document read at the contract source revision cannot outrank the change's contract material even when
 * it is larger. Both promotions into a contract rank — the tier-0 rank of a covered source and the
 * tier-1 rank of a contract-needing file — are gated on `plannedPaths`: one whose unit the planner will
 * not plan keeps only the rank its own classification gives it, exactly like a credentialed file the
 * planner excludes, so neither can take the admission order from the documents a planned reader charged.
 */
export function admissionUnits(
    changed: readonly SemanticChangedFile[],
    sidesByPath: ReadonlyMap<string, ContractCarryingSides>,
    admissionBytesBySide: ReadonlyMap<string, AdmissionSideBytes>,
    contractContexts: readonly { path: string; admissionBytes: number }[],
    specCovered: ReadonlyMap<string, string>,
    plannedPaths: ReadonlySet<string>
): readonly AdmissionUnit[] {
    const contractNeeding = contractNeedingPaths(changed);
    const filesByPath = new Map(changed.map((file) => [file.path, file]));
    const units: AdmissionUnit[] = [];
    for (const file of changed) {
        const sides = sidesByPath.get(file.path);
        const pathContractCarrying = (sides?.before ?? false) || (sides?.after ?? false);
        const coveringSpecPath = specCovered.get(file.path);
        const coveringSpec = coveringSpecPath === undefined ? undefined : filesByPath.get(coveringSpecPath);
        const covered = coveringSpec !== undefined && plannedPaths.has(file.path);
        const needsContract = contractNeeding.has(file.path) && plannedPaths.has(file.path);
        const orderFor = (side: AdmissionSide): AdmissionOrderPosition => {
            const ownBytes = admissionBytesBySide.get(file.path)?.[side] ?? 0;
            if (!covered || coveringSpec === undefined) {
                return {
                    path: file.path,
                    pathContractCarrying,
                    admissionBytes: ownBytes,
                    ownBytes,
                    pairRank: 1,
                };
            }
            return {
                path: coveringSpec.path,
                pathContractCarrying:
                    (sidesByPath.get(coveringSpec.path)?.before ?? false) ||
                    (sidesByPath.get(coveringSpec.path)?.after ?? false),
                // The smaller of the source's own side figure and the covering spec's own figure: a source
                // smaller than its spec keeps the room its own size earned, while a larger source is capped at
                // the spec's figure and `pairRank` keeps it immediately ahead of the spec.
                admissionBytes: Math.min(
                    ownBytes,
                    coveringSpecRankBytes(coveringSpec.kind, admissionBytesBySide.get(coveringSpec.path))
                ),
                ownBytes,
                pairRank: 0,
            };
        };
        if (kindHasBeforeSide(file.kind)) {
            units.push({
                kind: 'changed',
                file,
                side: 'before',
                contractCarrying: sides?.before ?? false,
                specCovered: covered,
                contractNeeding: needsContract,
                order: orderFor('before'),
            });
        }
        if (kindHasAfterSide(file.kind)) {
            units.push({
                kind: 'changed',
                file,
                side: 'after',
                contractCarrying: sides?.after ?? false,
                specCovered: covered,
                contractNeeding: needsContract,
                order: orderFor('after'),
            });
        }
    }
    for (const context of contractContexts) {
        units.push({
            kind: 'context',
            path: context.path,
            side: 'context',
            contractCarrying: true,
            order: {
                path: context.path,
                pathContractCarrying: true,
                admissionBytes: context.admissionBytes,
                ownBytes: context.admissionBytes,
                pairRank: 1,
            },
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

/**
 * The paths the admission content screen will mark `credential-shaped-content-excluded`, from the same
 * region text the screen reads: each side's hunks when the hunks were read, the whole side otherwise.
 *
 * The set is keyed the way admission keys a region, not by the change: a before side is admitted under
 * its previous path and an after side under the change's own path, so a rename whose previous side is
 * credential-shaped records the previous path. That distinction is what the context gate reads. The
 * planner skips a changed file only when its own path is in the excluded set, so a rename credentialed
 * on its previous side alone still plans a destination unit from its clean after side and must charge
 * the context its rules declare, while a modified file — whose two sides share one path — is skipped by
 * either side. Both sides are therefore judged independently and neither short-circuits the other: a
 * rename credentialed on *both* sides records its destination path as well, so the gate sees no unit to
 * charge, exactly as the planner plans none. This mirrors `admitSide`'s slicing rather than reading
 * again: the content was already read once for admission.
 */
export function credentialShapedPaths(
    changed: readonly SemanticChangedFile[],
    contents: ReadonlyMap<string, ChangedFileContents>,
    hunksByPath: ReadonlyMap<string, PathHunks>
): ReadonlySet<string> {
    const credential = new Set<string>();
    const sideHasCredential = (raw: string, ranges: readonly LineRange[] | undefined): boolean =>
        sideSlices(raw, ranges).some((text) => sensitiveContentReason(text) !== undefined);
    for (const file of changed) {
        const entry = contents.get(file.path);
        const hunks = hunksByPath.get(file.path);
        // Both sides are judged on their own content and neither skips the other: a rename or copy
        // credentialed on each side keys the previous path from its before side and the change's own
        // path from its after side.
        if (
            kindHasBeforeSide(file.kind) &&
            entry?.before !== undefined &&
            sideHasCredential(entry.before, hunks?.before)
        ) {
            credential.add(file.previousPath ?? file.path);
        }
        if (kindHasAfterSide(file.kind) && entry?.after !== undefined && sideHasCredential(entry.after, hunks?.after)) {
            credential.add(file.path);
        }
    }
    return credential;
}
