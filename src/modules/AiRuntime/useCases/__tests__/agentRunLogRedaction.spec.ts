import { beforeEach, describe, expect, it } from 'vitest';

import { type AgentRun, type AgentRunGrants, type AgentRunPlan, type AgentRunScope } from '../../models/AgentRun';
import { redactSecrets } from '../../services/agentRunRedaction/redactSecrets';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { projectAgentRunDiagnostics } from '../projectAgentRunDiagnostics';
import { projectAgentRunTelemetry } from '../projectAgentRunTelemetry';

/**
 * The provider-secret-boundary literal, copied exactly: it is the token shape
 * the repository secret scan allowlists, so any other token-shaped literal here
 * would fail CI rather than this spec.
 */
const CREDENTIAL = 'sk-fixture-SECRET-000000000000000000000000';
const CREDENTIAL_BASE64 = btoa(CREDENTIAL);
const CREDENTIAL_HEX = hex(CREDENTIAL);

const LYRIC = 'moonlight on the water';
const REQUEST = `write a hook: ${LYRIC}, hold me till the morning`;
const ERROR_MESSAGE = `The provider rejected the request with ${CREDENTIAL} in the echoed header.`;
const CANCELLATION_REASON = `Stopped the run because ${LYRIC} was the wrong hook.`;

const RUN_ID = 'run-redaction-fixture';
const CREATED_AT = 1000;
const CANCELLED_AT = 1600;

/**
 * Every leaf the telemetry tier may carry: identifiers, enum literals,
 * revisions and route names. A free-text leaf fails it by carrying a character
 * outside the set or a run of words no identifier has.
 */
const IDENTIFIER_LEAF = new RegExp('^[A-Za-z0-9 ._:@/+=-]{1,256}$');
const FOUR_WORD_RUN = /(?:\S+\s+){3}\S+/;

const SCOPE: AgentRunScope = {
    targetIds: ['track-hook'],
    targetRanges: [{ startBeat: 0, endBeat: 16 }],
    protectedTargetIds: ['track-vocals'],
    protectedRanges: [],
};

const GRANTS: AgentRunGrants = {
    allowedOperationPrefixes: ['addNotes', 'createMidiClip'],
    create: true,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};

const PLAN: AgentRunPlan = {
    summary: 'Write the hook clip.',
    commandIds: ['command-hook-1'],
    serializedBatchIdentity: 'batch-identity-hook',
    applicationToolReceipts: [],
    revision: 'heads-redaction-planned',
    classification: 'complex',
    showPlanPanel: true,
    objective: 'Write the hook clip.',
    interpretedConstraints: ['Plan is bound to the planned revision.'],
    scope: SCOPE,
    steps: [
        { order: 1, actionType: 'createMidiClip', description: `Open a clip for ${LYRIC}.` },
        { order: 2, actionType: 'addNotes', description: 'Write the hook melody into that clip.' },
    ],
    expectedImpact: {
        project: ['One new MIDI clip.'],
        audible: { status: 'not-claimed', reason: 'No audible result is claimed before the render.' },
    },
    capabilities: [],
    risks: [],
    approvalPoints: [{ kind: 'command-confirmation', reason: 'The batch writes notes into the project.' }],
    validationStrategy: ['Revalidate the planned revision before committing.'],
    stoppingConditions: ['Stop if the planned revision is no longer current.'],
    alternatives: [],
    needsUserDecision: false,
};

function hex(text: string): string {
    return Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function matchesCredential(text: string): boolean {
    return text.includes(CREDENTIAL) || text.includes(CREDENTIAL_BASE64) || text.toLowerCase().includes(CREDENTIAL_HEX);
}

/**
 * The provider-secret-boundary walker, narrowed to what a projection can hold.
 * A record is a plain JSON value tree, so the boundary spec's byte-buffer, Map
 * and Set branches have nothing to match here; the encoded forms are still
 * searched, because a serializer could write the credential as base64 or hex
 * and a flat substring test for the raw literal would miss that copy.
 */
function containsCredential(value: unknown, seen = new Set<object>()): boolean {
    if (typeof value === 'string') {
        return matchesCredential(value);
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) {
        return false;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.some((item) => containsCredential(item, seen));
    }
    return Object.values(value).some((nested) => containsCredential(nested, seen));
}

function collectStringLeaves(value: unknown, seen = new Set<object>()): string[] {
    if (typeof value === 'string') {
        return [value];
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) {
        return [];
    }
    seen.add(value);
    return Object.values(value).flatMap((nested) => collectStringLeaves(nested, seen));
}

function collectKeys(value: unknown, seen = new Set<object>()): string[] {
    if (typeof value !== 'object' || value === null || seen.has(value)) {
        return [];
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.flatMap((item) => collectKeys(item, seen));
    }
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectKeys(nested, seen)]);
}

function createFixtureRun(): AgentRun {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: REQUEST,
        mode: 'macro',
        createdRevision: 'heads-redaction-created',
        createdAt: CREATED_AT,
    });
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: PLAN.summary,
        commandIds: PLAN.commandIds,
        serializedBatchIdentity: PLAN.serializedBatchIdentity,
        revision: 'heads-redaction-planned',
        scope: SCOPE,
        grants: GRANTS,
        budgets: { limits: { providerTokens: 4000 }, consumed: { providerTokens: 1500 } },
        plan: PLAN,
        recordedAt: 1100,
    });
    agentRunLifecycle.recordProviderUsage({
        runId: RUN_ID,
        usage: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            inputTokens: 1200,
            outputTokens: 340,
            cachedInputTokens: 96,
            provenance: 'provider-reported',
            correlationId: 'correlation-hook-1',
            status: 'complete',
            routeId: 'route-cloud-1',
            executor: 'cloud',
            fallbackReason: 'provider-timeout',
            disclosure: {
                requestId: 'req-hook-0001',
                categories: ['prompt-text', 'lyrics'],
                retention: {
                    applicationState: 'unknown',
                    abuseMonitoring: 'unknown',
                    promptCache: 'unknown',
                    safetyLegalException: 'unknown',
                    unknown: 'unknown',
                },
            },
        },
        recordedAt: 1200,
    });
    agentRunLifecycle.recordBatch({
        runId: RUN_ID,
        batch: {
            batchId: 'batch-hook',
            commandIds: ['command-hook-1', 'command-hook-2', 'command-hook-3'],
            status: 'planned',
            receiptIdentity: null,
        },
        recordedAt: 1300,
    });
    agentRunLifecycle.recordCommittedWork({
        runId: RUN_ID,
        workId: 'batch-hook',
        receiptIdentity: `1:${RUN_ID}:batch-hook:committed`,
        completesRun: false,
        committedAt: 1400,
    });
    agentRunLifecycle.recordError({
        runId: RUN_ID,
        error: {
            code: 'provider-response-invalid',
            message: ERROR_MESSAGE,
            occurredAt: 1500,
            retriable: true,
            // Not bound to the batch: binding it would fail the committed batch
            // and take the committed batch status out of the telemetry pin.
            workId: null,
            category: 'provider',
            related: { targetIds: [], commandIds: [], workIds: [], receiptIdentities: [], artifactIds: [] },
            remediation: { retry: 'read-only', userAction: 'retry-later', compensation: 'not-needed' },
            cause: { kind: 'known-domain', source: 'provider-gateway' },
        },
        terminal: false,
        recordedAt: 1500,
    });
    agentRunLifecycle.cancel({ runId: RUN_ID, reason: CANCELLATION_REASON, requestedAt: CANCELLED_AT });

    const run = agentRunLifecycle.get(RUN_ID);
    if (!run) {
        throw new Error('Expected the redaction fixture run.');
    }
    return run;
}

describe('redactSecrets', () => {
    it('replaces a bearer token and keeps its label', () => {
        expect(redactSecrets('Bearer abcdefghijklmnopqrstuvwxyz012345')).toEqual({
            text: 'Bearer [redacted]',
            redactedCount: 1,
        });
    });

    it('replaces a provider key shape', () => {
        expect(redactSecrets(`sk-ant-${'a'.repeat(20)}`)).toEqual({ text: '[redacted]', redactedCount: 1 });
    });

    it('replaces an assigned api key exactly once', () => {
        expect(redactSecrets(`api_key: ${'f'.repeat(40)}`)).toEqual({
            text: 'api_key: [redacted]',
            redactedCount: 1,
        });
    });

    it('leaves project text untouched', () => {
        expect(redactSecrets(LYRIC)).toEqual({ text: LYRIC, redactedCount: 0 });
    });

    it('accepts empty input', () => {
        expect(redactSecrets('')).toEqual({ text: '', redactedCount: 0 });
    });
});

describe('agent run telemetry and diagnostics projections', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('carries no credential and no project content in the telemetry tier', () => {
        const record = projectAgentRunTelemetry(createFixtureRun());

        expect(containsCredential(record)).toBe(false);
        expect(JSON.stringify(record)).not.toContain('moonlight');
    });

    it('carries only identifier-shaped string leaves in the telemetry tier', () => {
        const leaves = collectStringLeaves(projectAgentRunTelemetry(createFixtureRun()));

        expect(leaves.length).toBeGreaterThan(0);
        expect(leaves.filter((leaf) => !IDENTIFIER_LEAF.test(leaf))).toEqual([]);
        expect(leaves.filter((leaf) => FOUR_WORD_RUN.test(leaf))).toEqual([]);
    });

    it('reports the run identity, route and correlation evidence', () => {
        const run = createFixtureRun();
        const usage = run.providerUsage[0];
        if (!usage) {
            throw new Error('Expected the recorded provider usage.');
        }

        const record = projectAgentRunTelemetry(run);

        expect(record.runId).toBe(run.runId);
        expect(record.revisions).toEqual(run.revisions);
        expect(record.mode).toBe(run.mode);
        expect(record.finalStatus).toBe(run.phase);
        expect(record.provider[0]).toMatchObject({
            provider: usage.provider,
            model: usage.model,
            routeId: usage.routeId,
            fallbackReason: usage.fallbackReason,
        });
        expect(record.correlation.requestIds).toContain(usage.disclosure?.requestId);
    });

    it('counts the plan steps, command batches and receipts', () => {
        const run = createFixtureRun();
        const plan = run.plan;
        const batch = run.batches[0];
        if (!plan || !batch) {
            throw new Error('Expected the recorded plan and batch.');
        }

        const record = projectAgentRunTelemetry(run);

        expect(record.plan?.stepCount).toBe(plan.steps.length);
        expect(record.plan?.actionTypes).toEqual(plan.steps.map((step) => step.actionType));
        expect(record.commands.batchCount).toBe(1);
        expect(record.commands.commandCount).toBe(batch.commandIds.length);
        expect(record.receipts.count).toBe(1);
    });

    it('sums reported token totals and reports null when no entry reported one', () => {
        const run = createFixtureRun();
        agentRunLifecycle.create({
            runId: 'run-unreported-tokens',
            request: 'Explain the mix.',
            mode: 'explain',
            createdRevision: 'heads-unreported',
            createdAt: 10,
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'run-unreported-tokens',
            usage: {
                provider: 'webllm',
                model: null,
                inputTokens: null,
                outputTokens: null,
                provenance: 'unavailable',
            },
            recordedAt: 20,
        });
        const unreported = agentRunLifecycle.get('run-unreported-tokens');
        if (!unreported) {
            throw new Error('Expected the unreported-token run.');
        }

        expect(projectAgentRunTelemetry(run).costs).toMatchObject({ inputTokens: 1200, outputTokens: 340 });
        expect(projectAgentRunTelemetry(unreported).costs).toMatchObject({ inputTokens: null, outputTokens: null });
    });

    it('reports elapsed time as a non-negative span', () => {
        const run = createFixtureRun();
        agentRunLifecycle.create({
            runId: 'run-backdated',
            request: 'Plan the bridge.',
            mode: 'plan',
            createdRevision: 'heads-backdated',
            createdAt: 5000,
        });
        agentRunLifecycle.transitionPhase({ runId: 'run-backdated', phase: 'planning', transitionedAt: 1000 });
        const backdated = agentRunLifecycle.get('run-backdated');
        if (!backdated) {
            throw new Error('Expected the backdated run.');
        }

        expect(projectAgentRunTelemetry(run).latency.runElapsedMs).toBe(run.updatedAt - run.createdAt);
        expect(backdated.updatedAt).toBeLessThan(backdated.createdAt);
        expect(projectAgentRunTelemetry(backdated).latency.runElapsedMs).toBe(0);
    });

    it('reports error classification without any message field', () => {
        const run = createFixtureRun();
        const error = run.errors[0];
        if (!error) {
            throw new Error('Expected the recorded error.');
        }

        const record = projectAgentRunTelemetry(run);

        expect(record.errors[0]?.code).toBe(error.code);
        expect(record.errors[0]?.category).toBe(error.category);
        expect(collectKeys(record)).not.toContain('message');
    });

    it('withholds every detail field by default', () => {
        const run = createFixtureRun();

        const record = projectAgentRunDiagnostics(run);

        expect(containsCredential(record)).toBe(false);
        expect(JSON.stringify(record)).not.toContain('moonlight');
        expect(record.detail.request).toEqual({ kind: 'withheld', length: run.request.length });
        expect(record.detail.errorMessages[0]?.kind).toBe('withheld');
    });

    it('carries redacted detail text when project content is requested', () => {
        const run = createFixtureRun();

        const record = projectAgentRunDiagnostics(run, { includeProjectContent: true });
        const request = record.detail.request;
        const errorMessage = record.detail.errorMessages[0];

        expect(request.kind).toBe('text');
        expect(request.kind === 'text' ? request.text : '').toContain(LYRIC);
        expect(errorMessage?.kind === 'text' ? errorMessage.text : '').toContain('[redacted]');
        expect(errorMessage?.kind === 'text' ? errorMessage.secretsRedacted : 0).toBeGreaterThanOrEqual(1);
        expect(containsCredential(record)).toBe(false);
    });

    it('returns fresh objects and leaves the run unchanged', () => {
        const run = createFixtureRun();
        const snapshot = structuredClone(run);

        const record = projectAgentRunTelemetry(run);
        projectAgentRunDiagnostics(run, { includeProjectContent: true });

        expect(record.revisions).not.toBe(run.revisions);
        expect(run).toEqual(snapshot);
    });
});
