import { createHash } from 'node:crypto';

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildRevisionContext, SEMANTIC_POLICY_VERSION, SEMANTIC_REPORT_FORMAT } from '../semanticReview/contracts.ts';
import { computePolicyDigest, computeRulesDigest } from '../semanticReview/rules.ts';
import {
    ADVISORY_WORKFLOW_EVENT,
    ADVISORY_WORKFLOW_PATH,
    primaryCheckRunsQuery,
    resolveCheckRunsPage,
    resolveSemanticReviewContext,
    SEMANTIC_CI_FORMAT,
    type SemanticActionRun,
    type SemanticArtifact,
    type SemanticCheckRun,
    type SemanticCiRecord,
    type SemanticReviewContextPort,
} from '../semanticReviewContext.ts';
import { SEMANTIC_REVIEW_UPLOAD_ARTIFACT_NAME } from '../semanticReviewWorkflowContract.ts';

const HEAD = 'a'.repeat(40);
const MERGE_BASE = 'b'.repeat(40);
const TARGET_BASE = 'c'.repeat(40);
const TRUSTED = 'd'.repeat(40);

const GREEN_CHECK: SemanticCheckRun = { id: 1, name: 'Semantic review', conclusion: 'success', checkSuiteId: 123 };
const RUN: SemanticActionRun = { id: 456, path: ADVISORY_WORKFLOW_PATH, event: ADVISORY_WORKFLOW_EVENT };
const ARTIFACT: SemanticArtifact = {
    id: 789,
    name: 'semantic-review-42-456-1',
    expiresAt: '2099-01-01T00:00:00.000Z',
};

/**
 * The producer's own upload-name template (`semanticReviewWorkflowContract.ts`), which
 * `healthGatesWorkflow.spec.ts` already pins against the live `.github/workflows/semantic-review.yml`.
 * Substituting concrete values here, rather than hand-writing a fixture name, ties this spec to that
 * producer contract instead of to a name this file invented independently of it.
 */
function producerArtifactName(pr: number, runId: number, attempt: number): string {
    return SEMANTIC_REVIEW_UPLOAD_ARTIFACT_NAME.replace('${{ env.PR_NUMBER }}', String(pr))
        .replace('${{ github.run_id }}', String(runId))
        .replace('${{ github.run_attempt }}', String(attempt));
}

function signal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ruleId: 'test-validity',
        unitId: 'src/unit.ts',
        path: 'src/unit.ts',
        outcome: 'no_signal',
        probability: 0.1,
        confidence: 0.9,
        disposition: 'no_additional_recommendation',
        investigationCategory: 'test-validity',
        missingEvidence: [],
        reasoning: 'the model declined to flag this',
        ...overrides,
    };
}

function scanReport(
    overrides: Record<string, unknown> = {},
    headSha: string = HEAD,
    prNumber = 42
): Record<string, unknown> {
    const rulesDigest = computeRulesDigest();
    const context = buildRevisionContext({
        repository: 'jcosta33/sourdaw',
        repositoryId: '1',
        prNumber,
        headSha,
        targetBaseSha: TARGET_BASE,
        mergeBaseSha: MERGE_BASE,
        trustedExecutionSha: TRUSTED,
        contractSourceSha: MERGE_BASE,
        evidenceProfile: 'ci',
        rulesDigest,
        policyVersion: SEMANTIC_POLICY_VERSION,
    });
    return {
        schemaVersion: SEMANTIC_REPORT_FORMAT,
        mode: 'scan',
        runId: 'test-run',
        context,
        requestedModel: 'jev',
        returnedModels: ['jev'],
        sdkVersion: '0.0.0',
        rulesDigest,
        policyDigest: computePolicyDigest(),
        policyVersion: SEMANTIC_POLICY_VERSION,
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        execution: 'partial',
        scope: {
            discovered: 4,
            eligible: 3,
            assessed: 2,
            cacheHits: 0,
            excluded: [{ path: 'docs/README.md', reason: 'no-applicable-rule' }],
            unassessed: [{ path: 'src/a.ts', reason: 'budget-exhausted-before-admission' }],
            truncated: [{ path: 'src/b.ts', reason: 'unit-evidence-did-not-fit' }],
        },
        signals: [
            signal({ outcome: 'insufficient_context', disposition: 'unresolved', probability: 0.5 }),
            signal({ outcome: 'no_signal', disposition: 'no_additional_recommendation', probability: 0.55 }),
            signal({ outcome: 'no_signal', disposition: 'no_additional_recommendation', probability: 0.2 }),
        ],
        limitations: ['a limitation'],
        usage: {
            networkAttempts: 1,
            logicalRequests: 1,
            retries: 0,
            submittedBytes: 100,
            actualInputTokens: 100,
            estimatedInputTokens: 100,
            attemptsWithUnknownUsage: 0,
            estimatedCostUsd: 0.01,
            pricingConfigurationVersion: 'typesafe-pricing-2026-09-20',
        },
        publication: { state: 'not_requested' },
        ...overrides,
    };
}

function zipFiles(files: Record<string, string>): Buffer {
    const encoded: Record<string, Uint8Array> = {};
    for (const [name, contents] of Object.entries(files)) {
        encoded[name] = new TextEncoder().encode(contents);
    }
    return Buffer.from(zipSync(encoded));
}

type PortInput = {
    checkRuns?: readonly SemanticCheckRun[];
    checkRunsError?: Error;
    actionRuns?: readonly SemanticActionRun[];
    actionRunsBySuite?: (checkSuiteId: number) => readonly SemanticActionRun[];
    actionRunsError?: Error;
    artifacts?: readonly SemanticArtifact[];
    artifactsByRun?: (runId: number) => readonly SemanticArtifact[];
    artifactsError?: Error;
    archive?: Buffer;
    archiveError?: Error;
    now?: number;
};

type PortCalls = {
    checkRuns: number;
    actionRuns: number;
    artifacts: number;
    downloads: number;
};

function makePort(input: PortInput): { port: SemanticReviewContextPort; calls: PortCalls } {
    const calls: PortCalls = { checkRuns: 0, actionRuns: 0, artifacts: 0, downloads: 0 };
    const port: SemanticReviewContextPort = {
        checkRuns: () => {
            calls.checkRuns += 1;
            if (input.checkRunsError !== undefined) {
                throw input.checkRunsError;
            }
            return input.checkRuns ?? [];
        },
        actionRuns: (checkSuiteId) => {
            calls.actionRuns += 1;
            if (input.actionRunsError !== undefined) {
                throw input.actionRunsError;
            }
            if (input.actionRunsBySuite !== undefined) {
                return input.actionRunsBySuite(checkSuiteId);
            }
            return input.actionRuns ?? [];
        },
        artifacts: (runId) => {
            calls.artifacts += 1;
            if (input.artifactsError !== undefined) {
                throw input.artifactsError;
            }
            if (input.artifactsByRun !== undefined) {
                return input.artifactsByRun(runId);
            }
            return input.artifacts ?? [];
        },
        downloadArchive: () => {
            calls.downloads += 1;
            if (input.archiveError !== undefined) {
                throw input.archiveError;
            }
            if (input.archive === undefined) {
                throw new Error('no archive configured');
            }
            return input.archive;
        },
        now: () => input.now ?? Date.parse('2026-09-01T00:00:00.000Z'),
    };
    return { port, calls };
}

function asAssessed(record: SemanticCiRecord): Extract<SemanticCiRecord, { state: 'assessed' }> {
    if (record.state !== 'assessed') {
        throw new Error(`expected an assessed record, got ${record.state}`);
    }
    return record;
}

describe('semantic review context', () => {
    it('projects coverage and abstention from a delivered scan report without its judgements', () => {
        const scanText = JSON.stringify(scanReport());
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': scanText }),
        });

        const result = resolveSemanticReviewContext(42, HEAD, port);

        expect(result).toMatchObject({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'assessed',
            assessedHeadSha: HEAD,
            execution: 'partial',
            scope: {
                discovered: 4,
                eligible: 3,
                assessed: 2,
                excluded: [{ path: 'docs/README.md', reason: 'no-applicable-rule' }],
                unassessed: [{ path: 'src/a.ts', reason: 'budget-exhausted-before-admission' }],
                truncated: [{ path: 'src/b.ts', reason: 'unit-evidence-did-not-fit' }],
            },
            unresolvedQuestions: 2,
            artifact: {
                id: 789,
                name: 'semantic-review-42-456-1',
                expiresAt: '2099-01-01T00:00:00.000Z',
            },
        });
        expect(asAssessed(result).artifact.digest).toBe(createHash('sha256').update(scanText).digest('hex'));
        expect(result).not.toHaveProperty('signals');
        expect(result).not.toHaveProperty('findingAssessments');
        expect(result).not.toHaveProperty('usage');
        expect(result).not.toHaveProperty('limitations');
        expect(result).not.toHaveProperty('requestedModel');
        expect(JSON.stringify(result)).not.toContain('reasoning');
        expect(JSON.stringify(result)).not.toContain('disposition');
        expect(JSON.stringify(result)).not.toContain('probability');
        expect(JSON.stringify(result)).not.toContain('the model declined to flag this');
    });

    it('finds the semantic check when it sits beyond the first page of check runs', () => {
        const fillers: SemanticCheckRun[] = Array.from({ length: 40 }, (_, index) => ({
            id: index + 1,
            name: `other-check-${index}`,
            conclusion: 'success',
            checkSuiteId: index + 1,
        }));
        const { port } = makePort({
            checkRuns: [...fillers, GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport()) }),
        });

        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'assessed',
            assessedHeadSha: HEAD,
        });
    });

    it('records a missing check run as no-assessment', () => {
        const { port } = makePort({ checkRuns: [] });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'absent',
        });
    });

    it('records a red check as no-assessment without downloading its artifact', () => {
        const { port, calls } = makePort({
            checkRuns: [{ id: 1, name: 'Semantic review', conclusion: 'failure', checkSuiteId: 123 }],
            actionRuns: [RUN],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'red-check',
        });
        expect(calls.downloads).toBe(0);
    });

    it('records a skipped check as no-assessment', () => {
        const { port } = makePort({
            checkRuns: [{ id: 1, name: 'Semantic review', conclusion: 'skipped', checkSuiteId: 123 }],
            actionRuns: [RUN],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'absent',
        });
    });

    it('records a check that has not completed as no-assessment with reason incomplete', () => {
        const { port } = makePort({
            checkRuns: [{ id: 1, name: 'Semantic review', conclusion: null, checkSuiteId: 123 }],
            actionRuns: [RUN],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'incomplete',
        });
    });

    it('records a missing semantic-review artifact as no-assessment', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [{ id: 1, name: 'other-artifact', expiresAt: '2099-01-01T00:00:00.000Z' }],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'absent',
        });
    });

    it('records an expired artifact as no-assessment without downloading it', () => {
        const { port, calls } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [{ id: 789, name: 'semantic-review-42-456-1', expiresAt: '2026-08-31T23:59:59.000Z' }],
            now: Date.parse('2026-09-01T00:00:00.000Z'),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'expired',
        });
        expect(calls.downloads).toBe(0);
    });

    it('records an unreadable archive as no-assessment', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: Buffer.from('not a zip archive'),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'unreadable',
        });
    });

    it('records an artifact that carries no report as no-assessment with reason absent', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'summary.md': 'no report here\n' }),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'absent',
        });
    });

    it('records an unparseable scan.json as no-assessment', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': 'not json{{{' }),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'malformed',
        });
    });

    it('records a structurally invalid report as no-assessment', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify({ schemaVersion: 'not-a-report' }) }),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'malformed',
        });
    });

    it('records a report bound to a different head as no-assessment with reason mismatch', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport({}, 'e'.repeat(40))) }),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'mismatch',
        });
    });

    it('does not throw when the check-runs read fails', () => {
        const { port } = makePort({ checkRunsError: new Error('network down') });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'unreadable',
        });
    });

    it('records a forbidden check-runs read as no-assessment, not absent', () => {
        const { port } = makePort({
            checkRunsError: new Error('gh: HTTP 403: Resource not accessible by integration'),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'forbidden',
        });
    });

    it('records a forbidden artifact download as no-assessment, not unreadable', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archiveError: new Error('gh: HTTP 403: Resource not accessible by integration'),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'forbidden',
        });
    });

    it('records an actions-runs read failure as unreadable, not absent', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRunsError: new Error('network down'),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'unreadable',
        });
    });

    it('records an artifacts read failure as unreadable, not absent', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifactsError: new Error('network down'),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'unreadable',
        });
    });

    it('selects the newest same-name check run rather than the first', () => {
        const { port } = makePort({
            checkRuns: [
                { id: 1, name: 'Semantic review', conclusion: 'failure', checkSuiteId: 111 },
                { id: 2, name: 'Semantic review', conclusion: 'success', checkSuiteId: 123 },
            ],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport()) }),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'assessed',
            assessedHeadSha: HEAD,
        });
    });

    it('does not adopt a newer same-name check whose suite maps to a different workflow', () => {
        const { port } = makePort({
            checkRuns: [
                { id: 1, name: 'Semantic review', conclusion: 'success', checkSuiteId: 111 },
                { id: 2, name: 'Semantic review', conclusion: 'success', checkSuiteId: 999 },
            ],
            actionRuns: [{ id: 456, path: '.github/workflows/other.yml', event: 'pull_request' }],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'absent',
        });
    });

    it('adopts the genuine advisory check when a newer same-name decoy maps to another workflow', () => {
        const { port } = makePort({
            checkRuns: [
                { id: 1, name: 'Semantic review', conclusion: 'success', checkSuiteId: 111 },
                { id: 2, name: 'Semantic review', conclusion: 'success', checkSuiteId: 999 },
            ],
            actionRunsBySuite: (suiteId) =>
                suiteId === 111 ? [RUN] : [{ id: 999, path: '.github/workflows/other.yml', event: 'pull_request' }],
            artifactsByRun: (runId) => {
                if (runId === 456) {
                    return [ARTIFACT];
                }
                return [{ id: 1, name: 'semantic-review-42-999-1', expiresAt: '2099-01-01T00:00:00.000Z' }];
            },
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport()) }),
        });
        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.artifact.name).toBe('semantic-review-42-456-1');
        expect(result.artifact.id).toBe(789);
    });

    it.each([
        ['path', { path: ADVISORY_WORKFLOW_PATH, event: 'workflow_dispatch' }],
        ['event', { path: '.github/workflows/other.yml', event: ADVISORY_WORKFLOW_EVENT }],
    ])('rejects a newer decoy matching only the %s half of the binding', (_label, decoyRun) => {
        const { port } = makePort({
            checkRuns: [
                { id: 1, name: 'Semantic review', conclusion: 'success', checkSuiteId: 111 },
                { id: 2, name: 'Semantic review', conclusion: 'success', checkSuiteId: 999 },
            ],
            actionRunsBySuite: (suiteId) => (suiteId === 111 ? [RUN] : [{ id: 999, ...decoyRun }]),
            artifactsByRun: (runId) => {
                if (runId === 456) {
                    return [ARTIFACT];
                }
                return [{ id: 1, name: 'semantic-review-42-999-1', expiresAt: '2099-01-01T00:00:00.000Z' }];
            },
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport()) }),
        });
        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.artifact.name).toBe('semantic-review-42-456-1');
    });

    it('refuses an artifact bound to a different pull request', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [{ id: 789, name: 'semantic-review-99-456-1', expiresAt: '2099-01-01T00:00:00.000Z' }],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'mismatch',
        });
    });

    it('selects the artifact bound to this pull request and run rather than the first prefix match', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [
                { id: 1, name: 'semantic-review-99-999-1', expiresAt: '2099-01-01T00:00:00.000Z' },
                { id: 789, name: 'semantic-review-42-456-1', expiresAt: '2099-01-01T00:00:00.000Z' },
            ],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport()) }),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'assessed',
            assessedHeadSha: HEAD,
        });
    });

    it('records an artifact bound to a different run id as no-assessment with reason mismatch', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [{ id: 1, name: 'semantic-review-42-999-1', expiresAt: '2099-01-01T00:00:00.000Z' }],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'mismatch',
        });
    });

    it('records a two-part legacy artifact name as no-assessment with reason absent', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [{ id: 1, name: 'semantic-review-42-456', expiresAt: '2099-01-01T00:00:00.000Z' }],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'absent',
        });
    });

    it.each([
        ['ascending', ['semantic-review-42-456-1', 'semantic-review-42-456-2']],
        ['descending', ['semantic-review-42-456-2', 'semantic-review-42-456-1']],
    ])('selects the highest-attempt artifact for this pr and run regardless of listing order (%s)', (_label, names) => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: names.map((name, index) => ({ id: index + 1, name, expiresAt: '2099-01-01T00:00:00.000Z' })),
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport()) }),
        });
        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.artifact.name).toBe('semantic-review-42-456-2');
    });

    it("selects the artifact named by the producer workflow's own upload-name template", () => {
        // Derived from `SEMANTIC_REVIEW_UPLOAD_ARTIFACT_NAME`
        // (`scripts/semanticReviewWorkflowContract.ts`), which `healthGatesWorkflow.spec.ts` already
        // pins byte-for-byte against the live `.github/workflows/semantic-review.yml` upload step, so
        // this case ties the reader to the producer's real template rather than to a hand-written name.
        const name = producerArtifactName(42, RUN.id, 1);
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [{ id: 789, name, expiresAt: '2099-01-01T00:00:00.000Z' }],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport()) }),
        });
        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.artifact.name).toBe(name);
    });

    it('refuses a report bound to a different pull request', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport({}, HEAD, 43)) }),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'mismatch',
        });
    });

    it('normalises out-of-vocabulary reasons and out-of-shape paths in scope entries', () => {
        const prose = 'this change is a security hole';
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({
                'scan.json': JSON.stringify(
                    scanReport({
                        scope: {
                            discovered: 4,
                            eligible: 3,
                            assessed: 2,
                            cacheHits: 0,
                            excluded: [{ path: '../etc/passwd', reason: prose }],
                            unassessed: [{ path: 'src/a.ts', reason: 'probability 0.9 the fix is wrong' }],
                            truncated: [{ path: 'src/b.ts', reason: 'the model reasoned this is broken' }],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.excluded).toEqual([{ path: '(unrecognized-path)', reason: 'unrecognized-reason' }]);
        expect(result.scope.unassessed).toEqual([{ path: 'src/a.ts', reason: 'unrecognized-reason' }]);
        expect(result.scope.truncated).toEqual([{ path: 'src/b.ts', reason: 'unrecognized-reason' }]);
        expect(JSON.stringify(result)).not.toContain(prose);
        expect(JSON.stringify(result)).not.toContain('probability');
    });

    it('normalises a parameterised reason whose qualifier is not a producer label', () => {
        const prose = 'the change is unsafe';
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({
                'scan.json': JSON.stringify(
                    scanReport({
                        scope: {
                            discovered: 4,
                            eligible: 3,
                            assessed: 2,
                            cacheHits: 0,
                            excluded: [{ path: 'docs/README.md', reason: 'no-applicable-rule' }],
                            unassessed: [{ path: 'src/a.ts', reason: 'budget-exhausted-before-admission' }],
                            truncated: [{ path: 'src/b.ts', reason: `region-exceeds-per-region-budget (${prose})` }],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated).toEqual([{ path: 'src/b.ts', reason: 'unrecognized-reason' }]);
        expect(JSON.stringify(result)).not.toContain(prose);
    });

    it('keeps the producer parameterised reasons with their closed qualifiers', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({
                'scan.json': JSON.stringify(
                    scanReport({
                        scope: {
                            discovered: 4,
                            eligible: 3,
                            assessed: 2,
                            cacheHits: 0,
                            excluded: [{ path: 'docs/README.md', reason: 'no-applicable-rule' }],
                            unassessed: [{ path: 'src/a.ts', reason: 'budget-exhausted-before-admission' }],
                            truncated: [
                                { path: 'src/b.ts', reason: 'hunk-beyond-file (before)' },
                                { path: 'src/c.ts', reason: 'region-exceeds-per-region-budget (after)' },
                                { path: 'src/d.ts', reason: 'total-evidence-budget-exhausted (context)' },
                                { path: 'src/e.ts', reason: 'region-exceeds-per-region-budget (contract)' },
                            ],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated.map((entry) => entry.reason)).toEqual([
            'hunk-beyond-file (before)',
            'region-exceeds-per-region-budget (after)',
            'total-evidence-budget-exhausted (context)',
            'region-exceeds-per-region-budget (contract)',
        ]);
    });

    it('pins the advisory workflow path and event literals from the captured run', () => {
        expect(ADVISORY_WORKFLOW_PATH).toBe('.github/workflows/semantic-review.yml');
        expect(ADVISORY_WORKFLOW_EVENT).toBe('pull_request_target');
    });

    it('names the check and latest filter with a full page in the primary query', () => {
        const query = primaryCheckRunsQuery('Semantic review');
        expect(query).toContain('check_name=Semantic%20review');
        expect(query).toContain('filter=latest');
        expect(query).toContain('per_page=100');
    });

    it('trusts a complete empty by-name page without falling through to the full list', () => {
        let fullQueried = false;
        const runs = resolveCheckRunsPage((query) => {
            if (query.includes('check_name')) {
                return { runs: [], totalCount: 0 };
            }
            fullQueried = true;
            return { runs: [], totalCount: 0 };
        });
        expect(runs).toEqual([]);
        expect(fullQueried).toBe(false);
    });

    it('falls back to the full list when the by-name page is truncated', () => {
        const queries: string[] = [];
        const runs = resolveCheckRunsPage((query) => {
            queries.push(query);
            if (query.includes('check_name')) {
                return { runs: [], totalCount: 101 };
            }
            return { runs: [GREEN_CHECK], totalCount: 1 };
        });
        expect(runs).toEqual([GREEN_CHECK]);
        expect(queries).toHaveLength(2);
    });

    it('refuses a truncated full list', () => {
        expect(() =>
            resolveCheckRunsPage((query) => {
                if (query.includes('check_name')) {
                    return { runs: [], totalCount: 101 };
                }
                return { runs: [], totalCount: 101 };
            })
        ).toThrow(/check-runs list is truncated/);
    });
});
