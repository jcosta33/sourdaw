/**
 * Deterministic revision, diff, and evidence collection.
 *
 * Source is read as data through an injected port, so nothing here spawns a process, checks out a
 * tree, or executes repository tooling. Every supplied source region gets an application-generated
 * identifier, a side, a revision, and a content hash; line numbers and paths come from this
 * processing, never from a model. A model may later select among the identifiers this module minted,
 * including the explicit `none` option, and every selection is validated against them.
 *
 * The default review unit is one changed file's before/after content plus a bounded set of related
 * context. The whole repository is never sent. When a region is dropped, truncated, or unavailable,
 * that is recorded as a limitation: an omitted region is not evidence that the region is safe.
 *
 * Admission is ranked in four tiers: a contract-carrying side — a trusted GitHub-write closure member,
 * a contract document (`AGENTS.md`, `.agents/decisions/`, `.agents/skills/`), a workflow file under
 * `.github/workflows/` named in `HEALTH_GATE_WORKFLOW_FILES` (the repository's declared trust
 * boundary), a collected spec whose content imports a closure member or names one of those workflow
 * files, or a source such a spec covers and whose unit will be planned — ordered at the larger of its
 * own side figure and that spec's figure, so the pair sits at the larger member's size and stays ahead
 * of its own spec without outranking material unrelated to it — first, then a changed file
 * whose unit the planner will plan and whose rules declare a contract, decision or registration token,
 * then each contract-context region the caller supplies, then bulk sides. The ranking admits the
 * change's own contract material ahead of the context documents, and attempts a planned
 * contract-needing file's own sides before the context those rules charge. One predicate,
 * `plannedUnitPaths` — the files whose own path the screen keeps, whose rules admit them, and which
 * carry a side admission mints a region for — gates the charge of the default contract documents, a
 * contract-needing file's tier-1 promotion, and the tier-0 promotion of a source a contract-carrying
 * spec covers. A file that produces no unit is gated out of all three; a side contract-carrying by its
 * own path and content holds tier 0 by that classification, and the reserve the request fitter takes is
 * keyed on the context the unit carries, never on this predicate. The predicate is a
 * pre-admission proxy, not a promise of what a request carries: it cannot know a unit's serialized
 * request budget, so a file it admits that the request fitter then leaves no region for is still
 * excluded by `planUnits`, and the document that file charged is read by nothing. The order decides
 * what the collector's total withholds and the order each unit's own and context regions are attempted
 * in, because the request fitter walks a unit's regions in the order admission handed them over and
 * spends that unit's budget first-come; it is not a claim that the carriage of a request is independent
 * of the order. A priority change therefore moves which region fits at a byte boundary, and a unit
 * whose budget sits on that boundary carries a different set of regions without its admitted set
 * changing at all. When that total binds before the context tier the document is withheld at admission,
 * no contract-context region reaches the request fitter, and the reserve that fitter takes whenever a
 * unit carries context has nothing to hold.
 * A region over the per-region ceiling
 * is never supplied: it is withheld and recorded, so a contract document larger than that ceiling is
 * never sent whatever its tier. Every withheld region is named, and that name carries the
 * region's own content class — contract-carrying per side, or a contract-context region — never its
 * admission tier: a tier-0 spec-covered source and a tier-1 contract-needing file read the plain side
 * qualifier, because the tier is only the order admission attempts the record in. Each side is
 * classified from the path and content it carries, so a deleted or moved spec still counts from its
 * before side, and a side of a path that is contract-carrying on either side keeps its bulk companion
 * ahead of a purely bulk path.
 */

import {
    assertLineRange,
    semanticTextDigest,
    type EvidenceReference,
    type EvidenceSide,
    type SemanticScopeExclusion,
} from './contracts.ts';
import {
    admissionBytesBySide,
    admissionUnits,
    chargeableRegionBytes,
    classifyContractCarryingSides,
    compareLexicographic,
    contractNeedingPaths,
    credentialShapedPaths,
    plannedUnitPaths,
    readChangedContents,
    specCoveredSources,
    type AdmissionUnit,
    type ChangedFileContents,
    type ContractCarryingSides,
} from './evidenceOrdering.ts';
import { applicableRules, isCollectedSpec } from './rules.ts';
import { sensitiveContentReason } from './sensitive.ts';
import { sliceLines, splitLines, type LineRange } from './slicing.ts';

export { compareByPath, compareLexicographic } from './evidenceOrdering.ts';
export type { LineRange } from './slicing.ts';
export { isContractCarryingContent, isContractCarryingPath } from './contractCarrying.ts';

export type SemanticChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export type SemanticChangedFile = {
    /** The post-change path; for a deletion, the path that was removed. */
    readonly path: string;
    /** The pre-change path when the change is a rename. */
    readonly previousPath?: string;
    readonly kind: SemanticChangeKind;
    readonly binary: boolean;
    readonly generated: boolean;
    readonly added: number;
    readonly deleted: number;
};

/**
 * The only source access this module has. The caller supplies Git-object reads; this module never
 * decides how they are performed.
 */
/**
 * The changed lines of one path, per side, with the margin the diff was taken at already applied.
 *
 * A review unit is the *change*, not the file it lands in: 17 of this change's 32 paths carried more
 * than the per-region budget as whole-file sides, against 7 whose diff does, and the diff of the same
 * change is 6.5% of the bytes. Each hunk is a region, so a question is given the lines the change
 * touched and a little context rather than a file it mostly does not need.
 */
export type PathHunks = {
    readonly path: string;
    readonly previousPath?: string;
    readonly before: readonly LineRange[];
    readonly after: readonly LineRange[];
};

export type SemanticSourcePort = {
    changedFiles: (mergeBaseSha: string, headSha: string) => readonly SemanticChangedFile[];
    /** The file's text at a revision, or `undefined` when the path does not exist there. */
    readFile: (sha: string, path: string) => string | undefined;
    /**
     * The changed line ranges per path, keyed by the post-change path. An empty map means the hunks
     * could not be read, and the collector then supplies each changed file's whole sides.
     */
    changedHunks: (mergeBaseSha: string, headSha: string) => ReadonlyMap<string, PathHunks>;
};

export type SemanticEvidenceLimits = {
    /** Maximum bytes of one supplied region; a longer file is truncated and recorded. */
    readonly maxRegionBytes: number;
    /** Maximum bytes of all supplied regions together. */
    readonly maxTotalBytes: number;
};

export type SemanticEvidenceSet = {
    readonly references: readonly EvidenceReference[];
    /** Region text keyed by `evidenceId`; the only source material a request may carry. */
    readonly contents: ReadonlyMap<string, string>;
    /**
     * The changed-file post-change paths that minted each region, keyed by `evidenceId`. A region
     * minted for two changed files — a copy whose unchanged source is also modified — lists both, so a
     * unit can select its own set from attribution rather than from the region's content path.
     */
    readonly attribution: ReadonlyMap<string, readonly string[]>;
    readonly excluded: readonly SemanticScopeExclusion[];
    readonly truncated: readonly SemanticScopeExclusion[];
    readonly limitations: readonly string[];
    /**
     * The sides the collector withheld at admission — a region over the per-region or total budget, a
     * credential-shaped region, or a hunk beyond the file — kept apart from the fitter's drops so a
     * side the model saw only in part still reports missing. Own regions are keyed by the changed file
     * that minted them; context regions belong to no single changed file and are reported globally.
     */
    readonly withheldSides: {
        readonly own: ReadonlyMap<string, ReadonlySet<EvidenceSide>>;
        readonly context: ReadonlySet<EvidenceSide>;
    };
};

/**
 * Paths whose content must not leave the machine. Secret scanning is defense in depth, not a
 * guarantee that arbitrary source has been sanitized, so a relevant exclusion is recorded as
 * incomplete context rather than silently dropped.
 */
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
    /(?:^|\/)\.env(?:\.|$)/u,
    /(?:^|\/)\.env\.sourdaw/u,
    /\.(?:pem|key|p12|pfx|keystore)$/iu,
    /(?:^|\/)id_(?:rsa|ed25519|ecdsa)$/u,
    /(?:^|\/)\.ssh\//u,
    /(?:^|\/)\.aws\//u,
    /(?:^|\/)\.npmrc$/u,
    /(?:^|\/)\.netrc$/u,
    /(?:^|\/)credentials(?:\.|$)/iu,
    /(?:^|\/)\.agents\/artifacts\//u,
    /(?:^|\/)transcripts?\//iu,
];

const LOCKFILE_NAMES: ReadonlySet<string> = new Set(['Cargo.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);

export function isSensitivePath(path: string): boolean {
    return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function baseName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
}

/** The rule ids a path admits, sorted so two sets can be compared for equality. */
function ruleIdsFor(path: string): string[] {
    return applicableRules([path])
        .map((rule) => rule.id)
        .sort(compareLexicographic);
}

/** Whether two paths admit different rule sets, so a rename between them still owes an assessment. */
function ruleSetsDiffer(left: string, right: string): boolean {
    const leftIds = ruleIdsFor(left);
    const rightIds = ruleIdsFor(right);
    return leftIds.length !== rightIds.length || leftIds.some((id, index) => id !== rightIds[index]);
}

/**
 * Why a changed path contributes no evidence. Each reason is recorded in the scope manifest, so an
 * excluded path stays visible rather than vanishing from the report.
 */
export function exclusionReason(file: SemanticChangedFile): string | undefined {
    if (isSensitivePath(file.path) || (file.previousPath !== undefined && isSensitivePath(file.previousPath))) {
        return 'sensitive-content-excluded';
    }
    if (file.binary) {
        return 'binary';
    }
    if (file.generated) {
        return 'generated';
    }
    if (LOCKFILE_NAMES.has(baseName(file.path))) {
        return 'dependency-lockfile';
    }
    if (file.added === 0 && file.deleted === 0) {
        // A pure rename has a zero-line diff, but a rename can still be a semantic change: it can move
        // a file out of a rule-covered surface, or stop a runner collecting it as a test. Calling every
        // such rename `no-text-change` excluded the path, and the skipped branch then read the change as
        // delivered advice over the very movement the rename performed. A rename that changes neither
        // the applicable rule set nor collection owes nothing. An exact copy shares the same zero-line
        // numstat but is not exempt: it adds a path to the tree, and `duplicates_existing_mechanism`
        // exists precisely to question a newly duplicated mechanism.
        if (file.kind === 'copied') {
            return undefined;
        }
        if (file.kind === 'renamed' && file.previousPath !== undefined) {
            const collectionChanged = isCollectedSpec(file.previousPath) !== isCollectedSpec(file.path);
            if (collectionChanged || ruleSetsDiffer(file.previousPath, file.path)) {
                return undefined;
            }
        }
        return 'no-text-change';
    }
    return undefined;
}

/**
 * Whether a region can be supplied at all.
 *
 * A region is supplied whole or not at all. Supplying a prefix was the earlier policy, and a prefix
 * of a side of a change answers nothing about that side: the questions that needed it scored a
 * fragment while the report said the region had been sent. A region that does not fit is omitted and
 * named, so the questions requiring it report the evidence as not supplied.
 */
function regionFits(text: string, maxBytes: number): boolean {
    return Buffer.byteLength(text, 'utf8') <= maxBytes;
}

type RegionRequest = {
    readonly revisionSha: string;
    readonly path: string;
    readonly side: EvidenceSide;
    /** The lines this region carries. Absent means the whole file at that revision. */
    readonly range?: LineRange;
    /**
     * The post-change path of the changed file this region is minted for. Absent for contract-context
     * regions, which belong to no single changed file.
     */
    readonly changedPath?: string;
};

/**
 * The one-letter prefix an evidence id carries for its side. Deleted code keeps its before-side
 * identity, so the prefix is part of what a reviewer reads in a report.
 */
export function evidenceSidePrefix(side: EvidenceSide): string {
    if (side === 'before') {
        return 'b';
    }
    if (side === 'after') {
        return 'a';
    }
    return 'c';
}

/** The resolved bounds of one region, matching the line accounting every region uses. */
function regionBounds(request: RegionRequest, text: string): LineRange {
    const lines = splitLines(text);
    return {
        startLine: request.range?.startLine ?? 1,
        endLine: request.range?.endLine ?? Math.max(1, lines.length),
    };
}

/**
 * The identity a region has. A region exists once per revision, path, side, and range; the content is
 * a function of exactly those four, so the bounds are enough to recognise a duplicate.
 */
function regionIdentity(request: RegionRequest, text: string): string {
    const bounds = regionBounds(request, text);
    return `${request.revisionSha}:${request.path}:${request.side}:${bounds.startLine}-${bounds.endLine}`;
}

function makeReference(request: RegionRequest, text: string, ordinal: number): EvidenceReference {
    const bounds = regionBounds(request, text);
    return {
        evidenceId: `${evidenceSidePrefix(request.side)}${String(ordinal)}`,
        revisionSha: request.revisionSha,
        path: request.path,
        side: request.side,
        startLine: bounds.startLine,
        endLine: bounds.endLine,
        contentHash: semanticTextDigest(text),
    };
}

function regionFor(port: SemanticSourcePort, revisionSha: string, path: string): string | undefined {
    return port.readFile(revisionSha, path);
}

/**
 * The scope-exclusion code the content screen records in `excluded`, and the withheld-scope code it
 * records in `truncated`. They are two vocabularies, not two spellings of one: an exclusion says the
 * path contributed no unit and was skipped whole, while a withheld code says why the reference never
 * left the machine. Only the scan records an exclusion, because only it plans units; both routes record
 * the withheld code, and `CREDENTIAL_SHAPED_WITHHELD_CODE` is shared so one withheld reference cannot
 * read two reasons.
 */
const CREDENTIAL_SHAPED_EXCLUSION_CODE = 'credential-shaped-content-excluded';

/** The content screen's withheld cause, emitted by the scan's admission and by verify's finding evidence. */
export const CREDENTIAL_SHAPED_WITHHELD_CODE = 'evidence-withheld-credential-shaped';

/** The path screen's withheld cause, emitted by both routes for a path the sensitive-path list covers. */
export const SENSITIVE_PATH_WITHHELD_CODE = 'evidence-withheld-sensitive-path';

/**
 * Records the side of a withheld region against its owning changed file, or globally for context.
 */
function recordWithheldSide(
    request: RegionRequest,
    ownWithheldSides: Map<string, Set<EvidenceSide>>,
    contextWithheldSides: Set<EvidenceSide>
): void {
    if (request.changedPath === undefined) {
        contextWithheldSides.add(request.side);
        return;
    }
    const sides = ownWithheldSides.get(request.changedPath);
    if (sides === undefined) {
        ownWithheldSides.set(request.changedPath, new Set([request.side]));
    } else {
        sides.add(request.side);
    }
}

/**
 * Withholds one side whose own content the screen refuses, when the region the side named cannot be
 * sliced: the region's text does not exist, so the side's content is what an equivalent whole-side
 * region would have carried. Returns whether it withheld, having recorded the credential cause both
 * routes share. No scope exclusion is recorded: the slices the screen did admit may still leave, and
 * `credentialShapedPaths` keys the context gate from those same slices.
 */
function withholdCredentialShapedSide(
    state: RegionAdmissionState,
    request: RegionRequest,
    raw: string,
    label: string
): boolean {
    const unsafe = sensitiveContentReason(raw);
    if (unsafe === undefined) {
        return false;
    }
    state.truncated.push({ path: request.path, reason: CREDENTIAL_SHAPED_WITHHELD_CODE });
    state.limitations.push(`evidence for ${request.path} (${label}) was withheld: it contains ${unsafe}`);
    recordWithheldSide(request, state.ownWithheldSides, state.contextWithheldSides);
    return true;
}

/**
 * Admits one side of one file: each changed hunk as its own region, or the whole side when the hunks
 * were not read. Per-hunk regions are what make a change assessable at all — a whole-file side
 * exceeded the per-region budget for 17 of this change's 32 paths, and one suspicious line now costs
 * that hunk rather than the whole file.
 *
 * A hunk that names lines the revision does not hold is withheld with the first cause that applies on
 * both routes: the content screen's credential cause when the side's content is credential-shaped, and
 * `hunk-beyond-file` only for a side the screen keeps.
 */
function admitSide(
    state: RegionAdmissionState,
    admit: (region: RegionRequest, text: string, regionLabel: string) => void,
    request: Omit<RegionRequest, 'range'>,
    raw: string,
    label: string,
    ranges: readonly LineRange[] | undefined
): void {
    if (ranges === undefined || ranges.length === 0) {
        admit(request, raw, label);
        return;
    }
    for (const range of ranges) {
        const sliced = sliceLines(raw, range);
        if (sliced === undefined) {
            if (!withholdCredentialShapedSide(state, request, raw, label)) {
                state.truncated.push({
                    path: request.path,
                    reason: withheldReason(request, label, 'hunk-beyond-file', state.contractCarryingSides),
                });
                state.limitations.push(
                    `evidence for ${request.path} (${label}) names lines this revision does not hold`
                );
                recordWithheldSide(request, state.ownWithheldSides, state.contextWithheldSides);
            }
            continue;
        }
        admit({ ...request, range: sliced.range }, sliced.text, label);
    }
}

export type WithheldRegionCause = 'region' | 'request' | 'total' | 'hunk-beyond-file';

/** The withheld-region code each cause emits, so every cause shares one vocabulary. */
function withheldCauseCode(cause: WithheldRegionCause): string {
    if (cause === 'region') {
        return 'region-exceeds-per-region-budget';
    }
    if (cause === 'request') {
        // The region fits the per-region ceiling; the request that would carry it — the state plus the
        // questions, whose text depends on which regions are supplied — does not fit the per-request
        // state ceiling. Naming the per-region code here would tell the reader a region was over a
        // budget it is under.
        return 'region-exceeds-per-request-budget';
    }
    if (cause === 'total') {
        return 'total-evidence-budget-exhausted';
    }
    return 'hunk-beyond-file';
}

/**
 * Whether a withheld region carries the contract class, from its own side and the contract-carrying
 * classification of that side.
 *
 * A context region always does: it is a document read at the contract source revision, supplied as
 * context because a rule declared it needs a contract, so its own path and content never decide its
 * class. Every other region reads the classification of the side the region comes from. Both routes
 * name a withheld reference through this one rule, so the same reference reads the same reason
 * whichever route produced it — a caller-supplied context path that no contract-carrying
 * classification covers is still named contract on both.
 */
export function withheldRegionCarriesContract(side: EvidenceSide, classifiedContractCarrying: boolean): boolean {
    return side === 'context' || classifiedContractCarrying;
}

/**
 * Whether a region belongs to a contract-carrying path, decided from the path and content of the side
 * the region comes from. Contract-context regions carry no changed path and are always contract.
 */
function isContractCarryingRegion(
    request: { readonly changedPath?: string; readonly side: EvidenceSide },
    contractCarryingSides: ReadonlyMap<string, ContractCarryingSides>
): boolean {
    const sides = request.changedPath === undefined ? undefined : contractCarryingSides.get(request.changedPath);
    const side = request.side === 'before' ? sides?.before : sides?.after;
    return withheldRegionCarriesContract(request.side, side ?? false);
}

/**
 * The one withheld-region vocabulary the scan and verify routes share. The cause stays the code —
 * `region-exceeds-per-region-budget`, `total-evidence-budget-exhausted`, or `hunk-beyond-file` — and
 * `contract` joins the side qualifier for a region `withheldRegionCarriesContract` classifies contract,
 * so the same withheld reference reads the same whichever route produced it. Every other region keeps
 * the plain `<code> (<side>)` form.
 *
 * Two causes carry no side qualifier, because each is decided before a region has a side class to join:
 * `CREDENTIAL_SHAPED_WITHHELD_CODE`, which the scan's admission and verify's finding evidence both emit,
 * and `SENSITIVE_PATH_WITHHELD_CODE`, which the path screen emits on both. Neither is the
 * scope-exclusion code `credential-shaped-content-excluded`: that code is recorded only in `excluded`,
 * by the scan alone, because only the scan plans units and an exclusion is what the planner skips on.
 *
 * The qualifier names the region's own content class — the side's `contractCarrying` classification, or
 * the contract-context class — and never the admission tier. A source a contract-carrying spec covers
 * ranks in that spec's tier and a contract-needing file ranks above the context its rules charge, yet
 * both are recorded with the plain side form because their own content carries no contract. The tier is
 * the order admission attempts the record in, not a property of what was withheld.
 */
export function withheldRegionReason(contractCarrying: boolean, side: string, cause: WithheldRegionCause): string {
    const base = withheldCauseCode(cause);
    return contractCarrying ? `${base} (${side}, contract)` : `${base} (${side})`;
}

/**
 * The reason a budget withholds one region, from the per-side contract-carrying classification the
 * collector built.
 */
function withheldReason(
    request: RegionRequest,
    label: string,
    cause: WithheldRegionCause,
    contractCarryingSides: ReadonlyMap<string, ContractCarryingSides>
): string {
    return withheldRegionReason(isContractCarryingRegion(request, contractCarryingSides), label, cause);
}

type RegionAdmissionState = {
    readonly limits: SemanticEvidenceLimits;
    readonly contractCarryingSides: ReadonlyMap<string, ContractCarryingSides>;
    readonly references: EvidenceReference[];
    readonly contents: Map<string, string>;
    readonly attribution: Map<string, Set<string>>;
    readonly excluded: SemanticScopeExclusion[];
    readonly excludedPaths: Set<string>;
    readonly truncated: SemanticScopeExclusion[];
    readonly limitations: string[];
    readonly ownWithheldSides: Map<string, Set<EvidenceSide>>;
    readonly contextWithheldSides: Set<EvidenceSide>;
    readonly identityToEvidenceId: Map<string, string>;
    totalBytes: number;
    ordinal: number;
};

/** Admits one region: the content screen, the two byte budgets, and the identifier. */
function admitRegion(state: RegionAdmissionState, request: RegionRequest, raw: string, label: string): void {
    // A region exists once per revision, path, side, and range. A copy whose source is itself changed
    // in the same diff reads that source's before side a second time; admitting it twice would charge
    // one region's bytes against the total budget in both units. The single minted region is instead
    // attributed to both changed files.
    const identity = regionIdentity(request, raw);
    const existing = state.identityToEvidenceId.get(identity);
    if (existing !== undefined) {
        if (request.changedPath !== undefined) {
            state.attribution.get(existing)?.add(request.changedPath);
        }
        return;
    }
    // The content screen runs before admission, on the whole region rather than the prefix, because a
    // credential later in the file is still a credential. An ordinary-looking filename is the case path
    // patterns cannot see.
    const unsafe = sensitiveContentReason(raw);
    if (unsafe !== undefined) {
        // One entry per path: the scope manifest counts paths, and both sides of a modified file would
        // otherwise be counted as two discoveries. The side is kept in the limitation.
        if (!state.excludedPaths.has(request.path)) {
            state.excludedPaths.add(request.path);
            state.excluded.push({ path: request.path, reason: CREDENTIAL_SHAPED_EXCLUSION_CODE });
        }
        // Recorded as incomplete scope as well as a note: a unit whose evidence was withheld was not
        // assessed, and a run that reported completion would have claimed otherwise. The exclusion above
        // and the withheld code below are separate vocabularies — the exclusion is the scope decision,
        // the code is why nothing left the machine — and `verify.ts` emits the same code.
        state.truncated.push({ path: request.path, reason: CREDENTIAL_SHAPED_WITHHELD_CODE });
        state.limitations.push(`evidence for ${request.path} (${label}) was withheld: it contains ${unsafe}`);
        recordWithheldSide(request, state.ownWithheldSides, state.contextWithheldSides);
        return;
    }
    if (!regionFits(raw, state.limits.maxRegionBytes)) {
        state.truncated.push({
            path: request.path,
            reason: withheldReason(request, label, 'region', state.contractCarryingSides),
        });
        state.limitations.push(
            `evidence for ${request.path} (${label}) was not supplied: it exceeds the per-region budget`
        );
        recordWithheldSide(request, state.ownWithheldSides, state.contextWithheldSides);
        return;
    }
    const bytes = Buffer.byteLength(raw, 'utf8');
    if (state.totalBytes + bytes > state.limits.maxTotalBytes) {
        state.truncated.push({
            path: request.path,
            reason: withheldReason(request, label, 'total', state.contractCarryingSides),
        });
        state.limitations.push(
            `evidence for ${request.path} (${label}) was omitted: the total evidence budget was exhausted`
        );
        recordWithheldSide(request, state.ownWithheldSides, state.contextWithheldSides);
        return;
    }
    state.totalBytes += bytes;
    const reference = makeReference(request, raw, state.ordinal);
    state.references.push(reference);
    state.contents.set(reference.evidenceId, raw);
    state.identityToEvidenceId.set(identity, reference.evidenceId);
    if (request.changedPath !== undefined) {
        state.attribution.set(reference.evidenceId, new Set([request.changedPath]));
    }
    state.ordinal += 1;
}

/**
 * Admission for one change's regions: the content screen, the two byte budgets, and the identifiers.
 *
 * It is a factory rather than part of the collector because the collector's job is deciding *which*
 * lines a question needs, and this is the separate job of deciding whether they may leave at all.
 */
function createRegionAdmission(
    limits: SemanticEvidenceLimits,
    contractCarryingSides: ReadonlyMap<string, ContractCarryingSides>
): {
    admit: (request: RegionRequest, raw: string, label: string) => void;
    admitSide: (
        request: Omit<RegionRequest, 'range'>,
        raw: string,
        label: string,
        ranges: readonly LineRange[] | undefined
    ) => void;
    references: EvidenceReference[];
    contents: Map<string, string>;
    attribution: Map<string, Set<string>>;
    excluded: SemanticScopeExclusion[];
    truncated: SemanticScopeExclusion[];
    limitations: string[];
    ownWithheldSides: Map<string, Set<EvidenceSide>>;
    contextWithheldSides: Set<EvidenceSide>;
} {
    const state: RegionAdmissionState = {
        limits,
        contractCarryingSides,
        references: [],
        contents: new Map(),
        attribution: new Map(),
        excluded: [],
        excludedPaths: new Set(),
        truncated: [],
        limitations: [],
        ownWithheldSides: new Map(),
        contextWithheldSides: new Set(),
        identityToEvidenceId: new Map(),
        totalBytes: 0,
        ordinal: 1,
    };
    const admit = (request: RegionRequest, raw: string, label: string): void => admitRegion(state, request, raw, label);
    return {
        admit,
        admitSide: (request, raw, label, ranges): void => admitSide(state, admit, request, raw, label, ranges),
        references: state.references,
        contents: state.contents,
        attribution: state.attribution,
        excluded: state.excluded,
        truncated: state.truncated,
        limitations: state.limitations,
        ownWithheldSides: state.ownWithheldSides,
        contextWithheldSides: state.contextWithheldSides,
    };
}

/**
 * Records every screened-out path into the admission result, so an excluded path stays visible rather
 * than vanishing from the report. A withheld secret is evidence that never left the machine, not an
 * irrelevant path like a binary or a lockfile; it must reach the completion layer exactly as the
 * content gate's withholdings do, or the same class of loss reports two different outcomes.
 */
function recordScreenExclusions(
    screened: readonly { file: SemanticChangedFile; reason: string | undefined }[],
    admission: { excluded: SemanticScopeExclusion[]; truncated: SemanticScopeExclusion[]; limitations: string[] }
): void {
    for (const { file, reason } of screened) {
        if (reason === undefined) {
            continue;
        }
        admission.excluded.push({ path: file.path, reason });
        if (reason === 'sensitive-content-excluded') {
            admission.truncated.push({ path: file.path, reason: SENSITIVE_PATH_WITHHELD_CODE });
            admission.limitations.push(`evidence for ${file.path} was withheld: it is on the sensitive-path list`);
        }
    }
}

/**
 * Admits one unit in admission order. A contract-context region is admitted whole; a changed side is
 * admitted hunk by hunk or whole. Content was read before admission — changed sides once in
 * `readChangedContents`, each contract-context region once when its chargeable bytes were computed — so
 * admission consumes that shared read rather than reading again.
 */
function admitUnit(
    unit: AdmissionUnit,
    input: {
        readonly admission: ReturnType<typeof createRegionAdmission>;
        readonly hunksByPath: ReadonlyMap<string, PathHunks>;
        readonly contents: ReadonlyMap<string, ChangedFileContents>;
        readonly contractContextContent: ReadonlyMap<string, string>;
        readonly mergeBaseSha: string;
        readonly headSha: string;
        readonly contractSourceSha: string;
    }
): void {
    const { admission, hunksByPath, contents, contractContextContent } = input;
    if (unit.kind === 'context') {
        const raw = contractContextContent.get(unit.path);
        if (raw === undefined) {
            admission.truncated.push({ path: unit.path, reason: 'evidence-unavailable-at-revision' });
            admission.limitations.push(`contract ${unit.path} was unavailable at the contract source revision`);
            return;
        }
        admission.admit({ revisionSha: input.contractSourceSha, path: unit.path, side: 'context' }, raw, 'context');
        return;
    }
    const file = unit.file;
    const hunks = hunksByPath.get(file.path);
    const entry = contents.get(file.path);
    if (unit.side === 'before') {
        const beforePath = file.previousPath ?? file.path;
        const before = entry?.before;
        if (before === undefined) {
            admission.truncated.push({ path: beforePath, reason: 'evidence-unavailable-at-revision' });
            admission.limitations.push(`before-side content for ${beforePath} was unavailable at the merge base`);
        } else {
            admission.admitSide(
                { revisionSha: input.mergeBaseSha, path: beforePath, side: 'before', changedPath: file.path },
                before,
                'before',
                hunks?.before
            );
        }
    } else {
        const after = entry?.after;
        if (after === undefined) {
            admission.truncated.push({ path: file.path, reason: 'evidence-unavailable-at-revision' });
            admission.limitations.push(`after-side content for ${file.path} was unavailable at the reviewed head`);
        } else {
            admission.admitSide(
                { revisionSha: input.headSha, path: file.path, side: 'after', changedPath: file.path },
                after,
                'after',
                hunks?.after
            );
        }
    }
}

/**
 * Whether any file `plannedUnitPaths` admits plans a unit whose rules declare a contract, decision or
 * registration token. A file that produces no unit charges nothing: one whose own path the content
 * screen excluded, whose rules admit it no question, or whose every side holds no region admission can
 * mint — over the per-region ceiling, or with no side to slice — is not in the predicate's set, so it
 * cannot charge the contract documents.
 *
 * The predicate is pre-admission, so this gate is too: a file it admits can still be excluded by the
 * request fitter as `no-evidence-region-within-budget`, and the document charged for it is then read by
 * nothing. The gate trades that residual charge for the documents it would otherwise read for a file no
 * request can carry.
 *
 * The own path decides, because that is what the planner skips on. A rename whose previous path was
 * excluded for a credential still plans a destination unit from its clean after side, so this gate
 * charges the context that unit's rules declare and will read; consulting the previous path here would
 * withhold the contract a planned unit asked for. A rename credentialed on both sides is keyed on both
 * paths by `credentialShapedPaths`, so it charges nothing here and plans nothing either. The caller
 * screens paths before calling.
 */
function planNeedsContractContext(files: readonly SemanticChangedFile[], plannedPaths: ReadonlySet<string>): boolean {
    const contractNeeding = contractNeedingPaths(files);
    for (const path of plannedPaths) {
        if (contractNeeding.has(path)) {
            return true;
        }
    }
    return false;
}

/** The default contract-context candidates, read at the contract source revision. */
function contractContextCandidates(port: SemanticSourcePort, contractSourceSha: string): string[] {
    const candidates = ['AGENTS.md', '.agents/decisions/README.md'];
    return candidates.filter((path) => port.readFile(contractSourceSha, path) !== undefined);
}

/**
 * Collects bounded evidence for one change. `mergeBaseSha` supplies before-side content and
 * `contractSourceSha` supplies the contracts used as semantic context; `headSha` supplies after-side
 * content. Deleted code keeps its before-side identity.
 */
export function collectEvidence(input: {
    port: SemanticSourcePort;
    mergeBaseSha: string;
    headSha: string;
    contractSourceSha: string;
    limits: SemanticEvidenceLimits;
    contractPaths?: readonly string[];
    /** Whether to add the default contract documents, gated on a planned unit that will actually read them. */
    includeDefaultContractContext?: boolean;
}): SemanticEvidenceSet {
    const changed = [...input.port.changedFiles(input.mergeBaseSha, input.headSha)];
    // Read once for the whole change: one `git diff` answers for every path, and an empty map means
    // the hunks were unavailable and each changed file is supplied whole.
    let hunksByPath: ReadonlyMap<string, PathHunks>;
    try {
        hunksByPath = input.port.changedHunks(input.mergeBaseSha, input.headSha);
    } catch {
        hunksByPath = new Map();
    }

    // Screen each changed path before any read, so excluded, binary, generated and lockfile paths are
    // never read. The screen is content-free; only the surviving paths reach the source port.
    const screened = changed.map((file) => ({ file, reason: exclusionReason(file) }));
    const assessed = screened.filter((entry) => entry.reason === undefined).map((entry) => entry.file);

    // Read each surviving path's sides once; classification, admission sizing, and admission itself all
    // consume this single read. Classifying from the same content the scan admits keeps each surviving
    // path to at most one content read.
    const contents = readChangedContents(input.port, input.mergeBaseSha, input.headSha, assessed);
    const contractCarryingSides = classifyContractCarryingSides(assessed, contents);
    const bytesBySide = admissionBytesBySide(
        assessed,
        contents,
        hunksByPath,
        input.limits.maxRegionBytes,
        input.mergeBaseSha,
        input.headSha
    );
    const specCovered = specCoveredSources(assessed, contents, bytesBySide);
    const credentialExcludedPaths = credentialShapedPaths(assessed, contents, hunksByPath);
    // The one predicate the charge and the order both read: the files whose own path the screen keeps,
    // whose rules admit them, and which carry a side admission mints a region for.
    const regionCeiling = input.limits.maxRegionBytes;
    const plannedPaths = plannedUnitPaths(assessed, contents, hunksByPath, regionCeiling, credentialExcludedPaths);
    // The default contract documents are charged only when the predicate finds a planned unit that
    // declares a contract token — an eligible file, with contract-declaring rules. That is the proxy and
    // not a promise: a unit the per-request fitter then leaves no region for is excluded by the planner
    // and the document charged for it is read by nothing. A rename's excluded previous path leaves that
    // unit standing on its clean after side, so it still charges the context it declared.
    const contextPaths = new Set<string>();
    const includeDefault =
        input.includeDefaultContractContext === true && planNeedsContractContext(assessed, plannedPaths);
    if (includeDefault) {
        for (const path of contractContextCandidates(input.port, input.contractSourceSha)) {
            contextPaths.add(path);
        }
    }
    for (const path of input.contractPaths ?? []) {
        contextPaths.add(path);
    }
    // Read each contract-context region once, so its chargeable bytes rank it with the contract class
    // and its content is admitted from that same read. A region that cannot be read still mints a unit,
    // so its unavailability is recorded in admission order rather than after every changed-file unit.
    const contractContextContent = new Map<string, string>();
    const contractContexts = Array.from(contextPaths).map((path) => {
        const raw = regionFor(input.port, input.contractSourceSha, path);
        if (raw !== undefined) {
            contractContextContent.set(path, raw);
        }
        return {
            path,
            admissionBytes: raw === undefined ? 0 : chargeableRegionBytes(raw, input.limits.maxRegionBytes),
        };
    });
    const units = admissionUnits(
        assessed,
        contractCarryingSides,
        bytesBySide,
        contractContexts,
        specCovered,
        plannedPaths
    );

    const admission = createRegionAdmission(input.limits, contractCarryingSides);

    recordScreenExclusions(screened, admission);

    for (const unit of units) {
        admitUnit(unit, {
            admission,
            hunksByPath,
            contents,
            contractContextContent,
            mergeBaseSha: input.mergeBaseSha,
            headSha: input.headSha,
            contractSourceSha: input.contractSourceSha,
        });
    }

    if (admission.references.length === 0) {
        admission.limitations.push('no source region was eligible for assessment');
    }
    const attribution = new Map<string, readonly string[]>();
    for (const [evidenceId, changedPaths] of admission.attribution) {
        attribution.set(evidenceId, [...changedPaths].sort(compareLexicographic));
    }
    const ownWithheld = new Map<string, ReadonlySet<EvidenceSide>>();
    for (const [changedPath, sides] of admission.ownWithheldSides) {
        ownWithheld.set(changedPath, sides);
    }
    return {
        references: admission.references,
        contents: admission.contents,
        attribution,
        excluded: admission.excluded,
        truncated: admission.truncated,
        limitations: admission.limitations,
        withheldSides: {
            own: ownWithheld,
            context: admission.contextWithheldSides,
        },
    };
}

/**
 * The state sent to the provider: the evidence regions as named fields, so a question can reference
 * them with a backticked path. This is the only place source leaves the machine.
 */
export function buildEvidenceState(set: SemanticEvidenceSet): Record<string, unknown> {
    const regions: Record<string, unknown> = {};
    for (const reference of set.references) {
        regions[reference.evidenceId] = {
            path: reference.path,
            side: reference.side,
            revisionSha: reference.revisionSha,
            startLine: reference.startLine,
            endLine: reference.endLine,
            content: set.contents.get(reference.evidenceId) ?? '',
        };
    }
    return { evidence: regions };
}

/** The state and named questions for one unit, built together so the two cannot disagree. */
export function buildUnitRequestState(
    set: SemanticEvidenceSet,
    unit: { readonly unitId: string; readonly path: string }
): Record<string, unknown> {
    return { unit: { unitId: unit.unitId, path: unit.path }, ...buildEvidenceState(set) };
}

export function assertEvidenceIntegrity(references: readonly EvidenceReference[]): void {
    const seen = new Set<string>();
    for (const reference of references) {
        if (seen.has(reference.evidenceId)) {
            throw new Error(`duplicate evidence id ${reference.evidenceId}`);
        }
        seen.add(reference.evidenceId);
        assertLineRange(reference.startLine, reference.endLine, `evidence ${reference.evidenceId}`);
    }
}
