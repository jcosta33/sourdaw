/**
 * Machine-readable coverage and abstention for the advisory `Semantic review` CI check.
 *
 * `review:prepare` writes this module's result as `semantic-ci.json` beside `risk-plan.json` so an
 * orchestrator can see what the assessment looked at and what it withheld without reading the
 * assessment's own findings. A green check means the assessment was delivered, never that the change
 * is clean; an incomplete or red check, a missing artifact, an expired artifact, an unreadable
 * archive, a malformed report, a forbidden read, or a pull-request mismatch are all recorded as
 * `no-assessment` with their reason, and none of them throws.
 *
 * `absent` names only a check that genuinely never ran (absent or skipped). A read that fails is
 * `unreadable` and a read that is denied is `forbidden`, so a broken transport can never masquerade
 * as a check that was not produced. A consumer reads `execution` and the scope counts rather than
 * `state` alone: a `skipped` execution with a zero scope is a complete assessment of an empty scope,
 * not a missing one.
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
import { isSemanticFailureCode } from './semanticReview/contracts.ts';
import { parseReportJson, type SemanticReport } from './semanticReview/report.ts';
import { SEMANTIC_REVIEW_CHECK_NAME } from './semanticReviewWorkflowContract.ts';

export const SEMANTIC_CI_FORMAT = 'semantic-ci-v1';

export const SEMANTIC_REVIEW_ARTIFACT_PREFIX = 'semantic-review-';

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

function normalizeExclusionReason(reason: string): string {
    if (SCOPE_REASON_CODES.has(reason) || isSemanticFailureCode(reason)) {
        return reason;
    }
    if (PARAMETERIZED_REASON_PREFIXES.some((prefix) => reason.startsWith(`${prefix} (`) && reason.endsWith(')'))) {
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

/** The newest run of the semantic check, by run id, so a stale failure cannot outrank a fresh success. */
function newestNamedCheckRun(checkRuns: readonly SemanticCheckRun[]): SemanticCheckRun | undefined {
    let newest: SemanticCheckRun | undefined;
    for (const candidate of checkRuns) {
        if (candidate.name !== SEMANTIC_REVIEW_CHECK_NAME) {
            continue;
        }
        if (newest === undefined || candidate.id > newest.id) {
            newest = candidate;
        }
    }
    return newest;
}

/** The pull-request and run identity the producer encodes in an artifact name: `semantic-review-<pr>-<runId>`. */
type ArtifactIdentity = { readonly pr: number; readonly runId: number };

function artifactIdentity(name: string): ArtifactIdentity | undefined {
    if (!name.startsWith(SEMANTIC_REVIEW_ARTIFACT_PREFIX)) {
        return undefined;
    }
    const match = /^(\d+)-(\d+)$/.exec(name.slice(SEMANTIC_REVIEW_ARTIFACT_PREFIX.length));
    if (match === null) {
        return undefined;
    }
    const pr = Number(match[1]);
    const runId = Number(match[2]);
    if (!Number.isSafeInteger(pr) || !Number.isSafeInteger(runId)) {
        return undefined;
    }
    return { pr, runId };
}

function selectAssessmentArtifact(
    artifacts: readonly SemanticArtifact[]
): { readonly artifact: SemanticArtifact; readonly identity: ArtifactIdentity } | undefined {
    for (const candidate of artifacts) {
        const identity = artifactIdentity(candidate.name);
        if (identity !== undefined) {
            return { artifact: candidate, identity };
        }
    }
    return undefined;
}

type SemanticCheckResolution = { readonly checkSuiteId: number } | { readonly reason: SemanticCiNoAssessmentReason };

function resolveSemanticCheck(headSha: string, port: SemanticReviewContextPort): SemanticCheckResolution {
    let checkRuns: readonly SemanticCheckRun[];
    try {
        checkRuns = port.checkRuns(headSha);
    } catch (error) {
        return { reason: readFailureReason(error) };
    }
    const check = newestNamedCheckRun(checkRuns);
    if (check === undefined) {
        return { reason: 'absent' };
    }
    if (check.conclusion !== 'success') {
        if (check.conclusion === null) {
            return { reason: 'incomplete' };
        }
        if (check.conclusion === 'skipped') {
            return { reason: 'absent' };
        }
        return { reason: 'red-check' };
    }
    if (check.checkSuiteId === null) {
        return { reason: 'absent' };
    }
    return { checkSuiteId: check.checkSuiteId };
}

export function resolveSemanticReviewContext(
    pr: number,
    headSha: string,
    port: SemanticReviewContextPort
): SemanticCiRecord {
    const checkResolution = resolveSemanticCheck(headSha, port);
    if ('reason' in checkResolution) {
        return noAssessment(pr, headSha, checkResolution.reason);
    }

    let actionRuns: readonly SemanticActionRun[];
    try {
        actionRuns = port.actionRuns(checkResolution.checkSuiteId);
    } catch (error) {
        return noAssessment(pr, headSha, readFailureReason(error));
    }
    const run = actionRuns[0];
    if (run === undefined) {
        return noAssessment(pr, headSha, 'absent');
    }

    let artifacts: readonly SemanticArtifact[];
    try {
        artifacts = port.artifacts(run.id);
    } catch (error) {
        return noAssessment(pr, headSha, readFailureReason(error));
    }
    const selected = selectAssessmentArtifact(artifacts);
    if (selected === undefined) {
        return noAssessment(pr, headSha, 'absent');
    }
    if (selected.identity.pr !== pr || selected.identity.runId !== run.id) {
        return noAssessment(pr, headSha, 'mismatch');
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
        return noAssessment(pr, headSha, 'absent');
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

type CheckRunsPage = {
    readonly runs: readonly SemanticCheckRun[];
    readonly totalCount: number;
};

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
        checkRuns: (headSha) => {
            const latest = queryCheckRuns(session, cwd, headSha, primaryCheckRunsQuery(SEMANTIC_REVIEW_CHECK_NAME));
            if (latest.runs.length > 0) {
                return latest.runs;
            }
            // The by-name query is the primary path: it returns exactly the latest run of this check,
            // so a head with many check runs cannot truncate it out of the default 30-run page. Fall
            // back to the full list only when it returns nothing: if the commit still has the check
            // under a name the filter missed, the resolver's own name search finds it. A page shorter
            // than the total count cannot prove the check is absent, so it is surfaced as a failed read
            // rather than letting the resolver report `absent` from a partial list.
            const full = queryCheckRuns(session, cwd, headSha, 'filter=all&per_page=100');
            if (full.runs.length < full.totalCount) {
                throw new Error(
                    `check-runs list is truncated (${String(full.runs.length)} of ${String(full.totalCount)})`
                );
            }
            return full.runs;
        },
        actionRuns: (checkSuiteId) =>
            ghJson<readonly SemanticActionRun[]>(
                session,
                cwd,
                [
                    'api',
                    `repos/${REQUIRED_REPOSITORY}/actions/runs?check_suite_id=${String(checkSuiteId)}`,
                    '--jq',
                    '[.workflow_runs[] | {id}]',
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
