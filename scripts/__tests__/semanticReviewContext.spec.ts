import { createHash } from 'node:crypto';

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildRevisionContext, SEMANTIC_POLICY_VERSION, SEMANTIC_REPORT_FORMAT } from '../semanticReview/contracts.ts';
import { computePolicyDigest, computeRulesDigest } from '../semanticReview/rules.ts';
import {
    resolveSemanticReviewContext,
    SEMANTIC_CI_FORMAT,
    type SemanticActionRun,
    type SemanticArtifact,
    type SemanticCheckRun,
    type SemanticCiRecord,
    type SemanticReviewContextPort,
} from '../semanticReviewContext.ts';

const HEAD = 'a'.repeat(40);
const MERGE_BASE = 'b'.repeat(40);
const TARGET_BASE = 'c'.repeat(40);
const TRUSTED = 'd'.repeat(40);

const GREEN_CHECK: SemanticCheckRun = { name: 'Semantic review', conclusion: 'success', checkSuiteId: 123 };
const RUN: SemanticActionRun = { id: 456 };
const ARTIFACT: SemanticArtifact = {
    id: 789,
    name: 'semantic-review-42-456',
    expiresAt: '2099-01-01T00:00:00.000Z',
};

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

function scanReport(overrides: Record<string, unknown> = {}, headSha: string = HEAD): Record<string, unknown> {
    const rulesDigest = computeRulesDigest();
    const context = buildRevisionContext({
        repository: 'jcosta33/sourdaw',
        repositoryId: '1',
        prNumber: 42,
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
    actionRunsError?: Error;
    artifacts?: readonly SemanticArtifact[];
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
        actionRuns: () => {
            calls.actionRuns += 1;
            if (input.actionRunsError !== undefined) {
                throw input.actionRunsError;
            }
            return input.actionRuns ?? [];
        },
        artifacts: () => {
            calls.artifacts += 1;
            if (input.artifactsError !== undefined) {
                throw input.artifactsError;
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
                name: 'semantic-review-42-456',
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
            checkRuns: [{ name: 'Semantic review', conclusion: 'failure', checkSuiteId: 123 }],
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
            checkRuns: [{ name: 'Semantic review', conclusion: 'skipped', checkSuiteId: 123 }],
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'absent',
        });
    });

    it('records a check that has not completed as no-assessment with reason incomplete', () => {
        const { port } = makePort({
            checkRuns: [{ name: 'Semantic review', conclusion: null, checkSuiteId: 123 }],
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
            artifacts: [{ id: 789, name: 'semantic-review-42-456', expiresAt: '2026-08-31T23:59:59.000Z' }],
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

    it('records an archive without scan.json as no-assessment', () => {
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

    it('records a report bound to a different head as no-assessment', () => {
        const { port } = makePort({
            checkRuns: [GREEN_CHECK],
            actionRuns: [RUN],
            artifacts: [ARTIFACT],
            archive: zipFiles({ 'scan.json': JSON.stringify(scanReport({}, 'e'.repeat(40))) }),
        });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toMatchObject({
            state: 'no-assessment',
            reason: 'absent',
        });
    });

    it('does not throw when the check-runs read fails', () => {
        const { port } = makePort({ checkRunsError: new Error('network down') });
        expect(resolveSemanticReviewContext(42, HEAD, port)).toEqual({
            format: SEMANTIC_CI_FORMAT,
            pr: 42,
            headSha: HEAD,
            state: 'no-assessment',
            reason: 'absent',
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
});
