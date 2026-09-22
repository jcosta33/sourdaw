/**
 * Machine-readable coverage and abstention for the advisory `Semantic review` CI check.
 *
 * `review:prepare` writes this module's result as `semantic-ci.json` beside `risk-plan.json` so an
 * orchestrator can see what the assessment looked at and what it withheld without reading the
 * assessment's own findings. A green check means the assessment was delivered, never that the change
 * is clean; an incomplete or red check, a missing artifact, an expired artifact, an unreadable
 * archive, a malformed report, or a forbidden read are all recorded as `no-assessment` with their
 * reason, and none of them throws.
 *
 * The projection is coverage-only. The report's signals, findings, reasoning, question text, and
 * probabilities never reach the bundle: feeding a downstream reviewer the assessment's judgements
 * anchors it, so the bundle carries only the scope, the abstentions, and the revision it covers.
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
    'absent' | 'incomplete' | 'expired' | 'unreadable' | 'malformed' | 'red-check' | 'forbidden';

export type SemanticCiNoAssessment = {
    readonly format: typeof SEMANTIC_CI_FORMAT;
    readonly pr: number;
    readonly headSha: string;
    readonly state: 'no-assessment';
    readonly reason: SemanticCiNoAssessmentReason;
};

export type SemanticCiRecord = SemanticCiAssessment | SemanticCiNoAssessment;

export type SemanticCheckRun = {
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

function readFailureReason(error: unknown, fallback: SemanticCiNoAssessmentReason): SemanticCiNoAssessmentReason {
    return error instanceof Error && /\bHTTP (401|403)\b/u.test(error.message) ? 'forbidden' : fallback;
}

function projectionOf(entry: { readonly path: string; readonly reason: string }): SemanticCiExclusion {
    return { path: entry.path, reason: entry.reason };
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

export function resolveSemanticReviewContext(
    pr: number,
    headSha: string,
    port: SemanticReviewContextPort
): SemanticCiRecord {
    let checkRuns: readonly SemanticCheckRun[];
    try {
        checkRuns = port.checkRuns(headSha);
    } catch (error) {
        return noAssessment(pr, headSha, readFailureReason(error, 'absent'));
    }
    const check = checkRuns.find((candidate) => candidate.name === SEMANTIC_REVIEW_CHECK_NAME);
    if (check === undefined) {
        return noAssessment(pr, headSha, 'absent');
    }
    if (check.conclusion !== 'success') {
        if (check.conclusion === null) {
            return noAssessment(pr, headSha, 'incomplete');
        }
        if (check.conclusion === 'skipped') {
            return noAssessment(pr, headSha, 'absent');
        }
        return noAssessment(pr, headSha, 'red-check');
    }
    if (check.checkSuiteId === null) {
        return noAssessment(pr, headSha, 'absent');
    }

    let actionRuns: readonly SemanticActionRun[];
    try {
        actionRuns = port.actionRuns(check.checkSuiteId);
    } catch (error) {
        return noAssessment(pr, headSha, readFailureReason(error, 'absent'));
    }
    const run = actionRuns[0];
    if (run === undefined) {
        return noAssessment(pr, headSha, 'absent');
    }

    let artifacts: readonly SemanticArtifact[];
    try {
        artifacts = port.artifacts(run.id);
    } catch (error) {
        return noAssessment(pr, headSha, readFailureReason(error, 'absent'));
    }
    const artifact = artifacts.find((candidate) => candidate.name.startsWith(SEMANTIC_REVIEW_ARTIFACT_PREFIX));
    if (artifact === undefined) {
        return noAssessment(pr, headSha, 'absent');
    }
    if (Date.parse(artifact.expiresAt) <= port.now()) {
        return noAssessment(pr, headSha, 'expired');
    }

    let archive: Buffer;
    try {
        archive = port.downloadArchive(artifact.id);
    } catch (error) {
        return noAssessment(pr, headSha, readFailureReason(error, 'unreadable'));
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
            id: artifact.id,
            name: artifact.name,
            expiresAt: artifact.expiresAt,
            digest: createHash('sha256').update(scanJsonBytes).digest('hex'),
        },
    };
}

function ghJson<Value>(session: GhSession, cwd: string, args: string[], label: string): Value {
    return parseJson<Value>(spawnCapture('gh', args, { cwd, env: session.env }), label);
}

function queryCheckRuns(session: GhSession, cwd: string, headSha: string, query: string): readonly SemanticCheckRun[] {
    return ghJson<readonly SemanticCheckRun[]>(
        session,
        cwd,
        [
            'api',
            `repos/${REQUIRED_REPOSITORY}/commits/${headSha}/check-runs?${query}`,
            '--jq',
            '[.check_runs[] | {name, conclusion, checkSuiteId: .check_suite.id}]',
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
            const latest = queryCheckRuns(
                session,
                cwd,
                headSha,
                `check_name=${encodeURIComponent(SEMANTIC_REVIEW_CHECK_NAME)}&filter=latest&per_page=100`
            );
            if (latest.length > 0) {
                return latest;
            }
            // The by-name query is the primary path: it returns exactly the latest run of this check,
            // so a head with many check runs cannot truncate it out of the default 30-run page, and a
            // re-run's latest verdict is the one that counts. Fall back to the full list only when it
            // returns nothing: if the commit still has the check (total count non-zero) under a name
            // the filter missed, the resolver's own name search finds it; an empty list means the
            // check genuinely did not run and stays absent.
            return queryCheckRuns(session, cwd, headSha, 'per_page=100');
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
