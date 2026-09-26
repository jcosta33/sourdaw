/**
 * Machine-readable coverage and abstention for the advisory `Semantic review` CI check.
 *
 * `review:prepare` writes this module's result as `semantic-ci.json` beside `risk-plan.json` so an
 * orchestrator can see what the assessment looked at and what it withheld without reading the
 * assessment's own findings. A green check means the assessment was delivered, never that the change
 * is clean; an incomplete or red check, a missing artifact, an expired artifact, an unreadable
 * archive, a malformed report, a forbidden read, or a pull-request or revision mismatch are all
 * recorded as `no-assessment` with their reason, and none of them throws.
 *
 * `absent` names an assessment that was never produced: no `Semantic review` check ran, it was
 * skipped, its suite yielded no advisory workflow run, or the artifact carried no report. A read
 * that fails is `unreadable` and a read that is denied is `forbidden`, so a broken transport can
 * never masquerade as a check that was not produced. A consumer reads `execution` and the scope
 * counts rather than `state` alone: a `skipped` execution with a zero scope is a complete
 * assessment of an empty scope, not a missing one.
 *
 * The projection is coverage-only. The report's signals, findings, reasoning, question text, and
 * probabilities never reach the bundle, and each scope entry's `reason` is validated against the
 * producer's vocabulary with anything unrecognised normalised to a fixed code: feeding a downstream
 * reviewer the assessment's judgements anchors it, so the bundle carries only the scope, the
 * abstentions, and the revision it covers.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { unzipSync } from 'fflate';

import {
    parseJson,
    REQUIRED_REPOSITORY,
    spawnCapture,
    trustedChildExecutable,
    type GhSession,
} from './githubAppIdentity.ts';
import { EVIDENCE_SIDES, isSemanticFailureCode } from './semanticReview/contracts.ts';
import { parseReportJson, type SemanticReport } from './semanticReview/report.ts';
import { SEMANTIC_REVIEW_CHECK_NAME, SEMANTIC_REVIEW_WORKFLOW_FILE } from './semanticReviewWorkflowContract.ts';

export const SEMANTIC_CI_FORMAT = 'semantic-ci-v1';

export const SEMANTIC_REVIEW_ARTIFACT_PREFIX = 'semantic-review-';

/** The advisory workflow's path and trigger, which a resolved run must match before its artifact is adopted. */
export const ADVISORY_WORKFLOW_PATH = `.github/workflows/${SEMANTIC_REVIEW_WORKFLOW_FILE}`;
export const ADVISORY_WORKFLOW_EVENT = 'pull_request_target';

export type SemanticCiExclusion = {
    readonly path: string;
    readonly reason: string;
};

export type SemanticCiScope = {
    readonly discovered: number;
    readonly eligible: number;
    readonly assessed: number;
    readonly excluded: readonly SemanticCiExclusion[];
    readonly unassessed: readonly SemanticCiExclusion[];
    readonly truncated: readonly SemanticCiExclusion[];
};

export type SemanticCiArtifact = {
    readonly id: number;
    readonly name: string;
    readonly expiresAt: string;
    /** The sha256 of the `scan.json` bytes the artifact carries, binding this record to its payload. */
    readonly digest: string;
};

export type SemanticCiAssessment = {
    readonly format: typeof SEMANTIC_CI_FORMAT;
    readonly pr: number;
    readonly headSha: string;
    readonly state: 'assessed';
    /** The revision the report itself names, which the resolver has verified equals `headSha`. */
    readonly assessedHeadSha: string;
    readonly execution: SemanticReport['execution'];
    readonly scope: SemanticCiScope;
    readonly unresolvedQuestions: number;
    readonly artifact: SemanticCiArtifact;
};

export type SemanticCiNoAssessmentReason =
    'absent' | 'incomplete' | 'expired' | 'unreadable' | 'malformed' | 'red-check' | 'forbidden' | 'mismatch';

export type SemanticCiNoAssessment = {
    readonly format: typeof SEMANTIC_CI_FORMAT;
    readonly pr: number;
    readonly headSha: string;
    readonly state: 'no-assessment';
    readonly reason: SemanticCiNoAssessmentReason;
};

export type SemanticCiRecord = SemanticCiAssessment | SemanticCiNoAssessment;

export type SemanticCheckRun = {
    readonly id: number;
    readonly name: string;
    readonly conclusion: string | null;
    readonly checkSuiteId: number | null;
};

export type SemanticActionRun = {
    readonly id: number;
    readonly path: string;
    readonly event: string;
};

export type SemanticArtifact = {
    readonly id: number;
    readonly name: string;
    readonly expiresAt: string;
};

export type SemanticReviewContextPort = {
    readonly checkRuns: (headSha: string) => readonly SemanticCheckRun[];
    readonly actionRuns: (checkSuiteId: number) => readonly SemanticActionRun[];
    readonly artifacts: (runId: number) => readonly SemanticArtifact[];
    readonly downloadArchive: (artifactId: number) => Buffer;
    readonly now: () => number;
};

/**
 * The near-miss probability `report.ts` uses when its summary counts an answer as unresolved-or-close.
 * `report.ts` does not export it, so it is duplicated here; the two must stay equal for the projection
 * and the summary to report the same unresolved count.
 */
const NEAR_MISS_PROBABILITY = 0.5;

function noAssessment(pr: number, headSha: string, reason: SemanticCiNoAssessmentReason): SemanticCiNoAssessment {
    return { format: SEMANTIC_CI_FORMAT, pr, headSha, state: 'no-assessment', reason };
}

function readFailureReason(error: unknown): 'forbidden' | 'unreadable' {
    return error instanceof Error && /\bHTTP (401|403)\b/u.test(error.message) ? 'forbidden' : 'unreadable';
}

/** The fixed code an out-of-vocabulary scope-entry reason is normalised to. */
const UNRECOGNIZED_REASON = 'unrecognized-reason';

/** The fixed marker an out-of-shape scope-entry path is normalised to. */
const UNRECOGNIZED_PATH = '(unrecognized-path)';

/**
 * The producer's fixed scope-entry reason codes. Mirrored here rather than imported because the
 * collector and verifier spread them across three modules without a single exported vocabulary; the
 * two sides must stay equal, and a code the producer has not yet grown is normalised, never leaked.
 */
const SCOPE_REASON_CODES: ReadonlySet<string> = new Set([
    'sensitive-content-excluded',
    'binary',
    'generated',
    'dependency-lockfile',
    'no-text-change',
    'credential-shaped-content-excluded',
    'no-applicable-rule',
    'no-admissible-evidence',
    'budget-exhausted-before-admission',
    'evidence-withheld',
    'evidence-withheld-sensitive-path',
    'evidence-withheld-credential-shaped',
    'unit-evidence-reduced-below-request-budget',
    'dry-run',
    'dry-run-made-no-request',
    'evidence-unavailable-at-revision',
    'no-evidence-region-within-budget',
    'unit-evidence-did-not-fit',
    'unit-overhead-exceeds-request-budget',
]);

/** Producer reason codes that carry a parenthesised qualifier, e.g. `region-exceeds-per-region-budget (after)`. */
const PARAMETERIZED_REASON_PREFIXES: readonly string[] = [
    'hunk-beyond-file',
    'region-exceeds-per-region-budget',
    'total-evidence-budget-exhausted',
];

/** The closed qualifier labels the producer emits after a parameterised prefix: the evidence sides plus `contract`. */
const PARAMETERIZED_REASON_QUALIFIERS: ReadonlySet<string> = new Set([...EVIDENCE_SIDES, 'contract']);

function isParameterizedReason(reason: string): boolean {
    for (const prefix of PARAMETERIZED_REASON_PREFIXES) {
        const start = `${prefix} (`;
        if (reason.startsWith(start) && reason.endsWith(')')) {
            return PARAMETERIZED_REASON_QUALIFIERS.has(reason.slice(start.length, -1));
        }
    }
    return false;
}

function normalizeExclusionReason(reason: string): string {
    if (SCOPE_REASON_CODES.has(reason) || isSemanticFailureCode(reason) || isParameterizedReason(reason)) {
        return reason;
    }
    return UNRECOGNIZED_REASON;
}

/** A repo-relative path: slash-separated, no absolute prefix, and no `.`, `..`, or empty segment. */
function isRepoRelativePath(path: string): boolean {
    if (path === '' || path.startsWith('/') || path.includes('\\')) {
        return false;
    }
    return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function normalizeExclusionPath(path: string): string {
    return isRepoRelativePath(path) ? path : UNRECOGNIZED_PATH;
}

function projectionOf(entry: { readonly path: string; readonly reason: string }): SemanticCiExclusion {
    return { path: normalizeExclusionPath(entry.path), reason: normalizeExclusionReason(entry.reason) };
}

function unresolvedQuestionCount(report: SemanticReport): number {
    if (report.mode === 'verify') {
        let count = 0;
        for (const assessment of report.findingAssessments) {
            if (assessment.disposition === 'needs_more_evidence') {
                count += 1;
            }
        }
        return count;
    }
    let count = 0;
    for (const signal of report.signals) {
        if (signal.disposition === 'unresolved') {
            count += 1;
            continue;
        }
        if (signal.disposition === 'no_additional_recommendation' && signal.probability >= NEAR_MISS_PROBABILITY) {
            count += 1;
        }
    }
    return count;
}

/** The `scan.json` bytes inside an artifact archive, or `undefined` when the archive has none. */
function archiveScanJson(archive: Buffer): Buffer | undefined {
    const files = unzipSync(archive);
    const entry = files['scan.json'];
    if (entry === undefined) {
        return undefined;
    }
    return Buffer.from(entry);
}

/** The advisory workflow run among a suite's runs, matched by its path and `pull_request_target` event. */
function advisoryWorkflowRun(actionRuns: readonly SemanticActionRun[]): SemanticActionRun | undefined {
    return actionRuns.find(
        (candidate) => candidate.path === ADVISORY_WORKFLOW_PATH && candidate.event === ADVISORY_WORKFLOW_EVENT
    );
}

/** Same-name check runs, newest first, so a decoy from another workflow cannot hide a genuine advisory run. */
function sameNameChecksNewestFirst(checkRuns: readonly SemanticCheckRun[]): readonly SemanticCheckRun[] {
    return checkRuns
        .filter((candidate) => candidate.name === SEMANTIC_REVIEW_CHECK_NAME)
        .sort((left, right) => right.id - left.id);
}

/**
 * The pull-request, run, and attempt identity the producer encodes in an artifact name:
 * `semantic-review-<pr>-<runId>-<attempt>`. The attempt is a third, separately incremented segment
 * (`.github/workflows/semantic-review.yml`'s `Upload the advisory report` step), because a re-run
 * reuses the run id: a run-scoped name would collide with the previous attempt's still-immutable
 * artifact, fail the upload, and leave the softened download reading the superseded report.
 */
type ArtifactIdentity = { readonly pr: number; readonly runId: number; readonly attempt: number };

function artifactIdentity(name: string): ArtifactIdentity | undefined {
    if (!name.startsWith(SEMANTIC_REVIEW_ARTIFACT_PREFIX)) {
        return undefined;
    }
    const match = /^(\d+)-(\d+)-(\d+)$/.exec(name.slice(SEMANTIC_REVIEW_ARTIFACT_PREFIX.length));
    if (match === null) {
        return undefined;
    }
    const pr = Number(match[1]);
    const runId = Number(match[2]);
    const attempt = Number(match[3]);
    if (!Number.isSafeInteger(pr) || !Number.isSafeInteger(runId) || !Number.isSafeInteger(attempt)) {
        return undefined;
    }
    if (pr <= 0 || runId <= 0 || attempt <= 0) {
        return undefined;
    }
    return { pr, runId, attempt };
}

/**
 * The matching artifact with the highest attempt. A re-run of only the failed jobs does not re-run
 * the producer's assessment job, so more than one attempt can exist for the same run only when the
 * assessment itself was re-run — and the newest attempt is the one the check's conclusion describes.
 * Scanning every candidate rather than returning the first match keeps the choice independent of
 * listing order.
 */
function selectAssessmentArtifact(
    artifacts: readonly SemanticArtifact[],
    pr: number,
    runId: number
): { readonly artifact: SemanticArtifact; readonly identity: ArtifactIdentity } | undefined {
    let best: { readonly artifact: SemanticArtifact; readonly identity: ArtifactIdentity } | undefined;
    for (const candidate of artifacts) {
        const identity = artifactIdentity(candidate.name);
        if (identity === undefined || identity.pr !== pr || identity.runId !== runId) {
            continue;
        }
        if (best === undefined || identity.attempt > best.identity.attempt) {
            best = { artifact: candidate, identity };
        }
    }
    return best;
}

function hasAssessmentArtifact(artifacts: readonly SemanticArtifact[]): boolean {
    return artifacts.some((candidate) => artifactIdentity(candidate.name) !== undefined);
}

type AdvisoryCheckResolution =
    | { readonly check: SemanticCheckRun; readonly run: SemanticActionRun }
    | { readonly reason: SemanticCiNoAssessmentReason };

function resolveAdvisoryCheck(headSha: string, port: SemanticReviewContextPort): AdvisoryCheckResolution {
    let checkRuns: readonly SemanticCheckRun[];
    try {
        checkRuns = port.checkRuns(headSha);
    } catch (error) {
        return { reason: readFailureReason(error) };
    }
    for (const check of sameNameChecksNewestFirst(checkRuns)) {
        if (check.checkSuiteId === null) {
            continue;
        }
        let actionRuns: readonly SemanticActionRun[];
        try {
            actionRuns = port.actionRuns(check.checkSuiteId);
        } catch (error) {
            return { reason: readFailureReason(error) };
        }
        const run = advisoryWorkflowRun(actionRuns);
        if (run !== undefined) {
            return { check, run };
        }
    }
    return { reason: 'absent' };
}

export function resolveSemanticReviewContext(
    pr: number,
    headSha: string,
    port: SemanticReviewContextPort
): SemanticCiRecord {
    const resolution = resolveAdvisoryCheck(headSha, port);
    if ('reason' in resolution) {
        return noAssessment(pr, headSha, resolution.reason);
    }
    const { check, run } = resolution;

    if (check.conclusion !== 'success') {
        if (check.conclusion === null) {
            return noAssessment(pr, headSha, 'incomplete');
        }
        if (check.conclusion === 'skipped') {
            return noAssessment(pr, headSha, 'absent');
        }
        return noAssessment(pr, headSha, 'red-check');
    }

    let artifacts: readonly SemanticArtifact[];
    try {
        artifacts = port.artifacts(run.id);
    } catch (error) {
        return noAssessment(pr, headSha, readFailureReason(error));
    }
    const selected = selectAssessmentArtifact(artifacts, pr, run.id);
    if (selected === undefined) {
        return noAssessment(pr, headSha, hasAssessmentArtifact(artifacts) ? 'mismatch' : 'absent');
    }
    if (Date.parse(selected.artifact.expiresAt) <= port.now()) {
        return noAssessment(pr, headSha, 'expired');
    }

    let archive: Buffer;
    try {
        archive = port.downloadArchive(selected.artifact.id);
    } catch (error) {
        return noAssessment(pr, headSha, readFailureReason(error));
    }
    let scanJsonBytes: Buffer | undefined;
    try {
        scanJsonBytes = archiveScanJson(archive);
    } catch {
        return noAssessment(pr, headSha, 'unreadable');
    }
    if (scanJsonBytes === undefined) {
        return noAssessment(pr, headSha, 'absent');
    }

    let report: SemanticReport;
    try {
        report = parseReportJson(scanJsonBytes.toString('utf8'), 'semantic review scan.json');
    } catch {
        return noAssessment(pr, headSha, 'malformed');
    }
    if (report.context.headSha !== headSha) {
        return noAssessment(pr, headSha, 'mismatch');
    }
    if (report.context.prNumber !== undefined && report.context.prNumber !== pr) {
        return noAssessment(pr, headSha, 'mismatch');
    }

    return {
        format: SEMANTIC_CI_FORMAT,
        pr,
        headSha,
        state: 'assessed',
        assessedHeadSha: report.context.headSha,
        execution: report.execution,
        scope: {
            discovered: report.scope.discovered,
            eligible: report.scope.eligible,
            assessed: report.scope.assessed,
            excluded: report.scope.excluded.map(projectionOf),
            unassessed: report.scope.unassessed.map(projectionOf),
            truncated: report.scope.truncated.map(projectionOf),
        },
        unresolvedQuestions: unresolvedQuestionCount(report),
        artifact: {
            id: selected.artifact.id,
            name: selected.artifact.name,
            expiresAt: selected.artifact.expiresAt,
            digest: createHash('sha256').update(scanJsonBytes).digest('hex'),
        },
    };
}

function ghJson<Value>(session: GhSession, cwd: string, args: string[], label: string): Value {
    return parseJson<Value>(spawnCapture('gh', args, { cwd, env: session.env }), label);
}

/** The primary check-runs query: by name, latest only, full page, so a busy head cannot truncate it out. */
export function primaryCheckRunsQuery(checkName: string): string {
    return `check_name=${encodeURIComponent(checkName)}&filter=latest&per_page=100`;
}

export type CheckRunsPage = {
    readonly runs: readonly SemanticCheckRun[];
    readonly totalCount: number;
};

/**
 * The check-runs gate: trust a complete by-name page (empty or not), and fall back to the full list
 * only when the page is truncated, refusing a full list that is itself truncated. An empty complete
 * page is a real "no assessment" answer, never a prompt to go read the whole list.
 */
export function resolveCheckRunsPage(query: (query: string) => CheckRunsPage): readonly SemanticCheckRun[] {
    const latest = query(primaryCheckRunsQuery(SEMANTIC_REVIEW_CHECK_NAME));
    if (latest.runs.length === latest.totalCount) {
        return latest.runs;
    }
    const full = query('filter=all&per_page=100');
    if (full.runs.length < full.totalCount) {
        throw new Error(`check-runs list is truncated (${String(full.runs.length)} of ${String(full.totalCount)})`);
    }
    return full.runs;
}

function queryCheckRuns(session: GhSession, cwd: string, headSha: string, query: string): CheckRunsPage {
    return ghJson<CheckRunsPage>(
        session,
        cwd,
        [
            'api',
            `repos/${REQUIRED_REPOSITORY}/commits/${headSha}/check-runs?${query}`,
            '--jq',
            '{runs: [.check_runs[] | {id, name, conclusion, checkSuiteId: .check_suite.id}], totalCount: .total_count}',
        ],
        'check-runs'
    );
}

function downloadArchive(session: GhSession, cwd: string, artifactId: number): Buffer {
    const command = trustedChildExecutable('gh', session.env);
    const result = spawnSync(
        command,
        ['api', `repos/${REQUIRED_REPOSITORY}/actions/artifacts/${String(artifactId)}/zip`],
        {
            cwd,
            env: session.env,
            encoding: 'buffer',
            maxBuffer: 64 * 1024 * 1024,
            shell: false,
        }
    );
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        const stderr = result.stderr.toString('utf8').trim();
        if (stderr === '') {
            throw new Error(`gh api failed with exit ${String(result.status ?? 'signal')}`);
        }
        throw new Error(stderr);
    }
    return result.stdout;
}

export function shellSemanticReviewContextPort(session: GhSession, cwd: string): SemanticReviewContextPort {
    return {
        checkRuns: (headSha) => resolveCheckRunsPage((query) => queryCheckRuns(session, cwd, headSha, query)),
        actionRuns: (checkSuiteId) =>
            ghJson<readonly SemanticActionRun[]>(
                session,
                cwd,
                [
                    'api',
                    `repos/${REQUIRED_REPOSITORY}/actions/runs?check_suite_id=${String(checkSuiteId)}`,
                    '--jq',
                    '[.workflow_runs[] | {id, path, event}]',
                ],
                'actions runs'
            ),
        artifacts: (runId) =>
            ghJson<readonly SemanticArtifact[]>(
                session,
                cwd,
                [
                    'api',
                    `repos/${REQUIRED_REPOSITORY}/actions/runs/${String(runId)}/artifacts`,
                    '--jq',
                    '[.artifacts[] | {id, name, expiresAt: .expires_at}]',
                ],
                'artifacts'
            ),
        downloadArchive: (artifactId) => downloadArchive(session, cwd, artifactId),
        now: () => Date.now(),
    };
}
