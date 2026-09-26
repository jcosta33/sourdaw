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
 * Admission is ranked so a contract-carrying path — a trusted GitHub-write closure member, a contract
 * document (`AGENTS.md`, `.agents/decisions/`, `.agents/skills/`), a workflow file under
 * `.github/workflows/` named in `HEALTH_GATE_WORKFLOW_FILES` (the repository's declared trust
 * boundary), or a collected spec whose content imports a closure member or names one of those workflow
 * files — is admitted before bulk or generated material and named when a budget withholds it, so the
 * same budget is spent where the contract lives. Each side is classified from the path and content it
 * carries, so a deleted or moved spec still counts from its before side.
 */

import { isContractCarryingContent } from './contractCarrying.ts';
import {
    assertLineRange,
    semanticTextDigest,
    type EvidenceReference,
    type EvidenceSide,
    type SemanticScopeExclusion,
} from './contracts.ts';
import {
    admissionBytesByPath,
    compareForAdmission,
    compareLexicographic,
    kindHasAfterSide,
    kindHasBeforeSide,
    readChangedContents,
    type ChangedFileContents,
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

/** Records the side of a withheld region against its owning changed file, or globally for context. */
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
 * Admits one side of one file: each changed hunk as its own region, or the whole side when the hunks
 * were not read. Per-hunk regions are what make a change assessable at all — a whole-file side
 * exceeded the per-region budget for 17 of this change's 32 paths, and one suspicious line now costs
 * that hunk rather than the whole file.
 */
function admitSide(
    request: Omit<RegionRequest, 'range'>,
    raw: string,
    label: string,
    ranges: readonly LineRange[] | undefined,
    admit: (region: RegionRequest, text: string, regionLabel: string) => void,
    truncated: SemanticScopeExclusion[],
    limitations: string[],
    ownWithheldSides: Map<string, Set<EvidenceSide>>,
    contextWithheldSides: Set<EvidenceSide>,
    contractCarryingSides: ReadonlyMap<string, ContractCarryingSides>
): void {
    if (ranges === undefined || ranges.length === 0) {
        admit(request, raw, label);
        return;
    }
    for (const range of ranges) {
        const sliced = sliceLines(raw, range);
        if (sliced === undefined) {
            truncated.push({
                path: request.path,
                reason: withheldRegionReason(
                    isContractCarryingRegion(request, contractCarryingSides),
                    label,
                    'hunk-beyond-file'
                ),
            });
            limitations.push(`evidence for ${request.path} (${label}) names lines this revision does not hold`);
            recordWithheldSide(request, ownWithheldSides, contextWithheldSides);
            continue;
        }
        admit({ ...request, range: sliced.range }, sliced.text, label);
    }
}

export type WithheldRegionCause = 'region' | 'total' | 'hunk-beyond-file';

/** The withheld-region code each cause emits, so every cause shares one vocabulary. */
function withheldCauseCode(cause: WithheldRegionCause): string {
    if (cause === 'region') {
        return 'region-exceeds-per-region-budget';
    }
    if (cause === 'total') {
        return 'total-evidence-budget-exhausted';
    }
    return 'hunk-beyond-file';
}

/**
 * Whether a region belongs to a contract-carrying path, decided from the path and content of the side
 * the region comes from. Contract-context regions carry no changed path and are always contract.
 */
function isContractCarryingRegion(
    request: { readonly changedPath?: string; readonly side: EvidenceSide },
    contractCarryingSides: ReadonlyMap<string, ContractCarryingSides>
): boolean {
    if (request.changedPath === undefined) {
        return true;
    }
    const sides = contractCarryingSides.get(request.changedPath);
    if (sides === undefined) {
        return false;
    }
    return request.side === 'before' ? sides.before : sides.after;
}

/**
 * The one withheld-region vocabulary the scan and verify routes share. The cause stays the code —
 * `region-exceeds-per-region-budget`, `total-evidence-budget-exhausted`, or `hunk-beyond-file` — and
 * `contract` joins the side qualifier for a contract-carrying region, so the same withheld reference
 * reads the same whichever route produced it. Every other region keeps the plain `<code> (<side>)` form.
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
            state.excluded.push({ path: request.path, reason: 'credential-shaped-content-excluded' });
        }
        // Recorded as incomplete scope as well as a note: a unit whose evidence was withheld was not
        // assessed, and a run that reported completion would have claimed otherwise.
        state.truncated.push({ path: request.path, reason: 'evidence-withheld' });
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
        admitSide: (request, raw, label, ranges): void =>
            admitSide(
                request,
                raw,
                label,
                ranges,
                admit,
                state.truncated,
                state.limitations,
                state.ownWithheldSides,
                state.contextWithheldSides,
                state.contractCarryingSides
            ),
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

/** The contract-carrying classification of one changed path's two sides, decided per side from that side's own path and content. */
type ContractCarryingSides = { readonly before: boolean; readonly after: boolean };

/**
 * Classifies each changed path's sides from the path and content the side itself carries: the
 * pre-change path's before content for the before side, and the post-change path's after content for
 * the after side. A deleted or moved collected spec whose before side pins a closure member therefore
 * still classifies contract-carrying even though its after side is absent or unclassified.
 */
function classifyContractCarryingSides(
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

/** The changed paths that are contract-carrying on either side, for the admission order. */
function contractCarryingPaths(sidesByPath: ReadonlyMap<string, ContractCarryingSides>): ReadonlySet<string> {
    const contractCarrying = new Set<string>();
    for (const [path, sides] of sidesByPath) {
        if (sides.before || sides.after) {
            contractCarrying.add(path);
        }
    }
    return contractCarrying;
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
            admission.truncated.push({ path: file.path, reason: 'evidence-withheld-sensitive-path' });
            admission.limitations.push(`evidence for ${file.path} was withheld: it is on the sensitive-path list`);
        }
    }
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
    const contractCarrying = contractCarryingPaths(contractCarryingSides);
    const bytesByPath = admissionBytesByPath(assessed, contents, hunksByPath, input.limits.maxRegionBytes);
    const files = [...assessed].sort((left, right) => compareForAdmission(left, right, contractCarrying, bytesByPath));

    const admission = createRegionAdmission(input.limits, contractCarryingSides);
    const { admit, admitSide } = admission;

    recordScreenExclusions(screened, admission);

    for (const file of files) {
        const beforePath = file.previousPath ?? file.path;
        const hunks = hunksByPath.get(file.path);
        const entry = contents.get(file.path);
        if (kindHasBeforeSide(file.kind)) {
            const before = entry?.before;
            if (before === undefined) {
                admission.truncated.push({ path: beforePath, reason: 'evidence-unavailable-at-revision' });
                admission.limitations.push(`before-side content for ${beforePath} was unavailable at the merge base`);
            } else {
                admitSide(
                    { revisionSha: input.mergeBaseSha, path: beforePath, side: 'before', changedPath: file.path },
                    before,
                    'before',
                    hunks?.before
                );
            }
        }
        if (kindHasAfterSide(file.kind)) {
            const after = entry?.after;
            if (after === undefined) {
                admission.truncated.push({ path: file.path, reason: 'evidence-unavailable-at-revision' });
                admission.limitations.push(`after-side content for ${file.path} was unavailable at the reviewed head`);
            } else {
                admitSide(
                    { revisionSha: input.headSha, path: file.path, side: 'after', changedPath: file.path },
                    after,
                    'after',
                    hunks?.after
                );
            }
        }
    }

    for (const path of input.contractPaths ?? []) {
        const raw = regionFor(input.port, input.contractSourceSha, path);
        if (raw === undefined) {
            admission.truncated.push({ path, reason: 'evidence-unavailable-at-revision' });
            admission.limitations.push(`contract ${path} was unavailable at the contract source revision`);
            continue;
        }
        admit({ revisionSha: input.contractSourceSha, path, side: 'context' }, raw, 'context');
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
