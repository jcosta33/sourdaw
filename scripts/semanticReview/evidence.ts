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
 */

import {
    assertLineRange,
    semanticTextDigest,
    type EvidenceReference,
    type EvidenceSide,
    type SemanticScopeExclusion,
} from './contracts.ts';
import { applicableRules, isCollectedSpec } from './rules.ts';
import { sensitiveContentReason } from './sensitive.ts';

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
/** A contiguous run of lines in one revision of one file. */
export type LineRange = { readonly startLine: number; readonly endLine: number };

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
    readonly excluded: readonly SemanticScopeExclusion[];
    readonly truncated: readonly SemanticScopeExclusion[];
    readonly limitations: readonly string[];
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

const CONTRACT_PATH_PATTERNS: readonly RegExp[] = [
    /(?:^|\/)AGENTS\.md$/u,
    /(?:^|\/)\.agents\/decisions\//u,
    /(?:^|\/)\.agents\/skills\//u,
];

const LOCKFILE_NAMES: ReadonlySet<string> = new Set(['Cargo.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);

export function isSensitivePath(path: string): boolean {
    return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function isContractPath(path: string): boolean {
    return CONTRACT_PATH_PATTERNS.some((pattern) => pattern.test(path));
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
        // the applicable rule set nor collection owes nothing.
        if (file.previousPath !== undefined) {
            const collectionChanged = isCollectedSpec(file.previousPath) !== isCollectedSpec(file.path);
            if (collectionChanged || ruleSetsDiffer(file.previousPath, file.path)) {
                return undefined;
            }
        }
        return 'no-text-change';
    }
    return undefined;
}

function splitLines(text: string): string[] {
    return text.split('\n');
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

/** The named lines of `text`, clamped to what the file holds, or `undefined` when none remain. */
function sliceLines(text: string, range: LineRange): { text: string; range: LineRange } | undefined {
    const lines = splitLines(text);
    const last = Math.max(1, lines.length);
    const start = Math.min(Math.max(1, range.startLine), last);
    const end = Math.min(Math.max(start, range.endLine), last);
    const slice = lines.slice(start - 1, end);
    return slice.length === 0 ? undefined : { text: slice.join('\n'), range: { startLine: start, endLine: end } };
}

function regionFor(port: SemanticSourcePort, revisionSha: string, path: string): string | undefined {
    return port.readFile(revisionSha, path);
}

/**
 * Admission for one change's regions: the content screen, the two byte budgets, and the identifiers.
 *
 * It is a factory rather than part of the collector because the collector's job is deciding *which*
 * lines a question needs, and this is the separate job of deciding whether they may leave at all.
 */
function createRegionAdmission(limits: SemanticEvidenceLimits): {
    admit: (request: RegionRequest, raw: string, label: string) => void;
    admitSide: (
        request: Omit<RegionRequest, 'range'>,
        raw: string,
        label: string,
        ranges: readonly LineRange[] | undefined
    ) => void;
    references: EvidenceReference[];
    contents: Map<string, string>;
    excluded: SemanticScopeExclusion[];
    truncated: SemanticScopeExclusion[];
    limitations: string[];
} {
    const references: EvidenceReference[] = [];
    const contents = new Map<string, string>();
    const excluded: SemanticScopeExclusion[] = [];
    const excludedPaths = new Set<string>();
    const truncated: SemanticScopeExclusion[] = [];
    const limitations: string[] = [];
    const admitted = new Set<string>();
    let totalBytes = 0;
    let ordinal = 1;

    const admit = (request: RegionRequest, raw: string, label: string): void => {
        // A region exists once per revision, path, side, and range. A copy whose source is itself
        // changed in the same diff reads that source's before side a second time; admitting it twice
        // would charge one region's bytes against the total budget in both units.
        const identity = regionIdentity(request, raw);
        if (admitted.has(identity)) {
            return;
        }
        // Path classification runs before the read; this runs before admission, on the whole region
        // rather than the prefix, because a credential later in the file is still a credential. An
        // ordinary-looking filename is the case path patterns cannot see.
        const unsafe = sensitiveContentReason(raw);
        if (unsafe !== undefined) {
            // One entry per path: the scope manifest counts paths, and both sides of a modified file
            // would otherwise be counted as two discoveries. The side is kept in the limitation.
            if (!excludedPaths.has(request.path)) {
                excludedPaths.add(request.path);
                excluded.push({ path: request.path, reason: 'credential-shaped-content-excluded' });
            }
            // Recorded as incomplete scope as well as a note: a unit whose evidence was withheld was
            // not assessed, and a run that reported completion would have claimed otherwise.
            truncated.push({ path: request.path, reason: 'evidence-withheld' });
            limitations.push(`evidence for ${request.path} (${label}) was withheld: it contains ${unsafe}`);
            return;
        }
        if (!regionFits(raw, limits.maxRegionBytes)) {
            truncated.push({ path: request.path, reason: `region-exceeds-per-region-budget (${label})` });
            limitations.push(
                `evidence for ${request.path} (${label}) was not supplied: it exceeds the per-region budget`
            );
            return;
        }
        const text = raw;
        const bytes = Buffer.byteLength(text, 'utf8');
        if (totalBytes + bytes > limits.maxTotalBytes) {
            truncated.push({ path: request.path, reason: `total-evidence-budget-exhausted (${label})` });
            limitations.push(
                `evidence for ${request.path} (${label}) was omitted: the total evidence budget was exhausted`
            );
            return;
        }
        totalBytes += bytes;
        admitted.add(identity);
        const reference = makeReference(request, text, ordinal);
        references.push(reference);
        contents.set(reference.evidenceId, text);
        ordinal += 1;
    };

    /**
     * Admits one side of one file: each changed hunk as its own region, or the whole side when the
     * hunks were not read. Per-hunk regions are what make a change assessable at all — a whole-file
     * side exceeded the per-region budget for 17 of this change's 32 paths, and one suspicious line
     * now costs that hunk rather than the whole file.
     */
    const admitSide = (
        request: Omit<RegionRequest, 'range'>,
        raw: string,
        label: string,
        ranges: readonly LineRange[] | undefined
    ): void => {
        if (ranges === undefined || ranges.length === 0) {
            admit(request, raw, label);
            return;
        }
        for (const range of ranges) {
            const sliced = sliceLines(raw, range);
            if (sliced === undefined) {
                truncated.push({ path: request.path, reason: `hunk-beyond-file (${label})` });
                limitations.push(`evidence for ${request.path} (${label}) names lines this revision does not hold`);
                continue;
            }
            admit({ ...request, range: sliced.range }, sliced.text, label);
        }
    };
    return { admit, admitSide, references, contents, excluded, truncated, limitations };
}

/** Whether a change kind has a before side at the merge base; a copy's unchanged source is one. */
function kindHasBeforeSide(kind: SemanticChangeKind): boolean {
    return kind === 'modified' || kind === 'renamed' || kind === 'deleted' || kind === 'copied';
}

/** Whether a change kind has an after side at the reviewed head; a copy's new destination is one. */
function kindHasAfterSide(kind: SemanticChangeKind): boolean {
    return kind === 'added' || kind === 'modified' || kind === 'renamed' || kind === 'copied';
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
    const files = [...input.port.changedFiles(input.mergeBaseSha, input.headSha)].sort(compareByPath);
    // Read once for the whole change: one `git diff` answers for every path, and an empty map means
    // the hunks were unavailable and each changed file is supplied whole.
    let hunksByPath: ReadonlyMap<string, PathHunks>;
    try {
        hunksByPath = input.port.changedHunks(input.mergeBaseSha, input.headSha);
    } catch {
        hunksByPath = new Map();
    }

    const admission = createRegionAdmission(input.limits);
    const { admit, admitSide } = admission;

    for (const file of files) {
        const reason = exclusionReason(file);
        if (reason !== undefined) {
            admission.excluded.push({ path: file.path, reason });
            // A withheld secret is evidence that never left the machine, not an irrelevant path like a
            // binary or a lockfile. It must reach the completion layer exactly as the content gate's
            // withholdings do, or the same class of loss reports two different outcomes.
            if (reason === 'sensitive-content-excluded') {
                admission.truncated.push({ path: file.path, reason: 'evidence-withheld-sensitive-path' });
                admission.limitations.push(`evidence for ${file.path} was withheld: it is on the sensitive-path list`);
            }
            continue;
        }
        const beforePath = file.previousPath ?? file.path;
        const hunks = hunksByPath.get(file.path);
        if (kindHasBeforeSide(file.kind)) {
            const before = regionFor(input.port, input.mergeBaseSha, beforePath);
            if (before === undefined) {
                admission.truncated.push({ path: beforePath, reason: 'evidence-unavailable-at-revision' });
                admission.limitations.push(`before-side content for ${beforePath} was unavailable at the merge base`);
            } else {
                admitSide(
                    { revisionSha: input.mergeBaseSha, path: beforePath, side: 'before' },
                    before,
                    'before',
                    hunks?.before
                );
            }
        }
        if (kindHasAfterSide(file.kind)) {
            const after = regionFor(input.port, input.headSha, file.path);
            if (after === undefined) {
                admission.truncated.push({ path: file.path, reason: 'evidence-unavailable-at-revision' });
                admission.limitations.push(`after-side content for ${file.path} was unavailable at the reviewed head`);
            } else {
                admitSide({ revisionSha: input.headSha, path: file.path, side: 'after' }, after, 'after', hunks?.after);
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
        admit({ revisionSha: input.contractSourceSha, path, side: 'context' }, raw, 'contract');
    }

    if (admission.references.length === 0) {
        admission.limitations.push('no source region was eligible for assessment');
    }
    return {
        references: admission.references,
        contents: admission.contents,
        excluded: admission.excluded,
        truncated: admission.truncated,
        limitations: admission.limitations,
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
