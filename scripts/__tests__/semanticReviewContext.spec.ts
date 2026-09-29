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
    UNRECOGNIZED_SIGNAL_VALUE,
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

    it('projects the fired signals a scan carries, bounded to their rule, path and probability', () => {
        const fired = signal({
            ruleId: 'admission_branch_completes_without_asserting',
            path: 'src/modules/audio/take.test.ts',
            outcome: 'signal',
            probability: 0.82,
            confidence: 0.82,
            disposition: 'recommend_investigation',
            reasoning: 'yes probability 0.820 is at or above 0.7',
        });
        const unfired = [
            signal({ outcome: 'insufficient_context', disposition: 'unresolved', probability: 0.5 }),
            signal({ outcome: 'no_signal', disposition: 'no_additional_recommendation', probability: 0.55 }),
        ];
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport({ signals: [fired, ...unfired] })) }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.firedSignals).toEqual([
            {
                ruleId: 'admission_branch_completes_without_asserting',
                path: 'src/modules/audio/take.test.ts',
                probability: 0.82,
            },
        ]);
        // The fired signal carries only its rule, path, and probability: the reasoning, outcome band,
        // and disposition the producer recorded stay in the artifact.
        expect(JSON.stringify(result)).not.toContain('recommend_investigation');
        expect(JSON.stringify(result)).not.toContain('at or above');
    });

    it('caps the fired signals it records at the summary bound, leaving overflow in the artifact', () => {
        const fired = Array.from({ length: 7 }, (_unused, index) =>
            signal({
                ruleId: 'admission_branch_completes_without_asserting',
                path: `src/module/file-${index}.test.ts`,
                outcome: 'signal',
                probability: 0.8,
                confidence: 0.8,
                disposition: 'recommend_investigation',
            })
        );
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport({ signals: fired })) }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.firedSignals).toHaveLength(5);
    });

    it('records zero fired signals for a scan whose signals never recommend investigation', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport()) }),
        });
        expect(asAssessed(resolveSemanticReviewContext(42, HEAD, port)).firedSignals).toEqual([]);
    });

    it('redacts a fired signal whose projected path carries a credential shape, keeping the record', () => {
        const fired = signal({
            ruleId: 'conditional_admission_added',
            // Composed from parts so no single source literal matches the diff secret scan;
            // at runtime it is still a full `ghp_` + 36-char token shape, which the screening refuses.
            path: `src/ghp_${'0'.repeat(36)}/x.test.ts`,
            outcome: 'signal',
            probability: 0.9,
            confidence: 0.9,
            disposition: 'recommend_investigation',
        });
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport({ signals: [fired] })) }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        // The refused value becomes the fixed marker; the signal's slot, the cap, and the rest of
        // the assessed record survive, so `review:prepare` completes and the disposal duty at
        // publication stays writable against the marker the record carries. The screen's refusal is
        // no longer a throw — that aborted `review:prepare` before any bundle file was written,
        // a harder stop than the advisory assessment's non-existent merge authority (ADR 0047).
        expect(result.firedSignals).toEqual([
            { ruleId: 'conditional_admission_added', path: UNRECOGNIZED_SIGNAL_VALUE, probability: 0.9 },
        ]);
        expect(result).toMatchObject({
            state: 'assessed',
            assessedHeadSha: HEAD,
            scope: { discovered: 4, eligible: 3, assessed: 2 },
            artifact: { name: 'semantic-review-42-456-1' },
        });
        // No unscreened projected byte reaches the record `semantic-ci.json` serialises.
        expect(JSON.stringify(result)).not.toContain('ghp_');
        expect(JSON.stringify(result)).not.toContain('0'.repeat(36));
    });

    it('redacts a fired signal whose projected ruleId carries a credential shape, keeping its slot', () => {
        const fired = signal({
            // Composed from parts so no single source literal matches the diff secret scan.
            ruleId: `exposed_ghp_${'1'.repeat(36)}_rule`,
            path: 'src/modules/audio/take.test.ts',
            outcome: 'signal',
            probability: 0.9,
            confidence: 0.9,
            disposition: 'recommend_investigation',
        });
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport({ signals: [fired] })) }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.firedSignals).toEqual([
            { ruleId: UNRECOGNIZED_SIGNAL_VALUE, path: 'src/modules/audio/take.test.ts', probability: 0.9 },
        ]);
        expect(JSON.stringify(result)).not.toContain('ghp_');
        expect(JSON.stringify(result)).not.toContain('1'.repeat(36));
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
                                { path: 'src/f.ts', reason: 'hunk-beyond-file (after, contract)' },
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
            'hunk-beyond-file (after, contract)',
        ]);
    });

    it('keeps a withheld contract-carrying path named as such, apart from an anonymous bulk trim', () => {
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
                                {
                                    path: 'scripts/reviewDossier.ts',
                                    reason: 'total-evidence-budget-exhausted (after, contract)',
                                },
                                { path: 'src/big.ts', reason: 'total-evidence-budget-exhausted (after)' },
                            ],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated).toEqual([
            { path: 'scripts/reviewDossier.ts', reason: 'total-evidence-budget-exhausted (after, contract)' },
            { path: 'src/big.ts', reason: 'total-evidence-budget-exhausted (after)' },
        ]);
    });

    it('keeps a reduced-unit entry that names the sides the fitter dropped', () => {
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
                                {
                                    path: 'crates/daw-dsp/src/big.rs',
                                    reason: 'unit-evidence-reduced-below-request-budget (after)',
                                },
                                {
                                    path: 'crates/daw-dsp/src/wider.rs',
                                    reason: 'unit-evidence-reduced-below-request-budget (after, context)',
                                },
                            ],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated).toEqual([
            { path: 'crates/daw-dsp/src/big.rs', reason: 'unit-evidence-reduced-below-request-budget (after)' },
            {
                path: 'crates/daw-dsp/src/wider.rs',
                reason: 'unit-evidence-reduced-below-request-budget (after, context)',
            },
        ]);
    });

    it('keeps the three-term reduced-unit reason the fitter emits when it cuts every side', () => {
        // The fitter unions the own before/after drops with the context drop, so a unit cut on all three
        // sides emits `(before, after, context)`. Restoring the two-term qualifier cap would normalise
        // this real producer shape to `unrecognized-reason`; the projection must keep it. This guards the
        // previous repair's three-term qualifier support, not this change's context gate.
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
                                {
                                    path: 'src/modules/Project/cut.ts',
                                    reason: 'unit-evidence-reduced-below-request-budget (before, after, context)',
                                },
                            ],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated).toEqual([
            {
                path: 'src/modules/Project/cut.ts',
                reason: 'unit-evidence-reduced-below-request-budget (before, after, context)',
            },
        ]);
    });

    it('accepts the contract-marked comma qualifier and the retired withheld code for reading', () => {
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
                                {
                                    path: 'scripts/reviewDossier.ts',
                                    reason: 'region-exceeds-per-region-budget (after, contract)',
                                },
                                {
                                    path: 'scripts/reviewDossier.ts',
                                    reason: 'total-evidence-budget-exhausted (before, contract)',
                                },
                                { path: 'scripts/old.ts', reason: 'contract-evidence-withheld (after)' },
                            ],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated.map((entry) => entry.reason)).toEqual([
            'region-exceeds-per-region-budget (after, contract)',
            'total-evidence-budget-exhausted (before, contract)',
            'contract-evidence-withheld (after)',
        ]);
    });

    it('keeps a per-request size refusal as a known scope reason', () => {
        // A failed unit reaches this projection through its reason string, and anything the projection
        // does not recognize is normalised to `unrecognized-reason`. The per-request refusal is a
        // failure code of its own, so the scanned head keeps the exact reason a unit was withheld for.
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
                            unassessed: [{ path: 'src/modules/Project/big.ts', reason: 'request_too_large' }],
                            truncated: [{ path: 'src/b.ts', reason: 'unit-evidence-did-not-fit' }],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.unassessed).toEqual([{ path: 'src/modules/Project/big.ts', reason: 'request_too_large' }]);
    });

    it('keeps the missing-required-evidence omission as a known scope reason', () => {
        // A unit whose evidence never carried what its questions require is skipped without a request.
        // An unregistered reason would project to `unrecognized-reason` and read as an unknown cause
        // rather than as a unit the plan could not ask anything.
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
                            unassessed: [{ path: 'crates/daw-dsp/src/big.rs', reason: 'missing-required-evidence' }],
                            truncated: [{ path: 'src/b.ts', reason: 'unit-evidence-did-not-fit' }],
                        },
                        // The unit that made no request still reports every rule of its set, which is the
                        // coverage ledger its omission reason names: the producer always emits it.
                        signals: [
                            signal({
                                unitId: 'crates/daw-dsp/src/big.rs',
                                path: 'crates/daw-dsp/src/big.rs',
                                ruleId: 'audio_thread_allocation',
                                investigationCategory: 'realtime',
                            }),
                        ],
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.unassessed).toEqual([
            { path: 'crates/daw-dsp/src/big.rs', reason: 'missing-required-evidence' },
        ]);
    });

    it('keeps the deadline admission reason as a known scope reason', () => {
        // The units a run never attempted after its deadline are recorded with the deadline's own reason;
        // an unregistered one would project to `unrecognized-reason` and read as an unknown cause rather
        // than as a run that ran out of time.
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
                            assessed: 1,
                            cacheHits: 0,
                            excluded: [{ path: 'docs/README.md', reason: 'no-applicable-rule' }],
                            unassessed: [
                                { path: 'src/a.ts', reason: 'deadline_elapsed' },
                                { path: 'src/b.ts', reason: 'deadline-elapsed-before-admission' },
                            ],
                            truncated: [],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.unassessed).toEqual([
            { path: 'src/a.ts', reason: 'deadline_elapsed' },
            { path: 'src/b.ts', reason: 'deadline-elapsed-before-admission' },
        ]);
    });

    it('keeps the per-request withheld-region reason the verify collector emits', () => {
        // A region that fits the per-region ceiling but not the request that would carry it is withheld
        // with the shared reason shape and this cause. An unregistered cause would project to
        // `unrecognized-reason`, hiding which region was dropped and why from the scanned head.
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
                                {
                                    path: 'src/modules/Project/zzz.ts',
                                    reason: 'request-exceeds-state-budget (after)',
                                },
                            ],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated).toEqual([
            { path: 'src/modules/Project/zzz.ts', reason: 'request-exceeds-state-budget (after)' },
        ]);
    });

    it('normalises a parameterised reason with an unknown or duplicated qualifier term', () => {
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
                                { path: 'src/b.ts', reason: 'region-exceeds-per-region-budget (after, bogus)' },
                                { path: 'src/c.ts', reason: 'region-exceeds-per-region-budget (after, after)' },
                            ],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated).toEqual([
            { path: 'src/b.ts', reason: 'unrecognized-reason' },
            { path: 'src/c.ts', reason: 'unrecognized-reason' },
        ]);
    });

    it('keeps the withheld qualifier to the region classes the producer emits', () => {
        // `withheldRegionReason` names the region's own content class: a spec-covered source's own side
        // reads plain, a contract-carrying side and a contract-context region carry the contract term.
        // The tier is an attempt order over the record and never joins the qualifier; a tier term here
        // would project to `unrecognized-reason` and stop the scan and verify references reading alike.
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
                                {
                                    path: 'scripts/semanticReview/vocabulary.ts',
                                    reason: 'region-exceeds-per-region-budget (after)',
                                },
                                {
                                    path: 'scripts/reviewDossier.ts',
                                    reason: 'region-exceeds-per-region-budget (after, contract)',
                                },
                                {
                                    path: '.agents/decisions/README.md',
                                    reason: 'region-exceeds-per-region-budget (context, contract)',
                                },
                            ],
                        },
                    })
                ),
            }),
        });

        const result = asAssessed(resolveSemanticReviewContext(42, HEAD, port));
        expect(result.scope.truncated).toEqual([
            { path: 'scripts/semanticReview/vocabulary.ts', reason: 'region-exceeds-per-region-budget (after)' },
            { path: 'scripts/reviewDossier.ts', reason: 'region-exceeds-per-region-budget (after, contract)' },
            {
                path: '.agents/decisions/README.md',
                reason: 'region-exceeds-per-region-budget (context, contract)',
            },
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
