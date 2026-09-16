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

/**
 * Credential-shaped literals split across source lines so no single line
 * carries a recognisable secret beside its label; the joined values still
 * exercise the same redaction shapes.
 *
 * The bearer value is shorter than the encoded-run threshold and carries a dot,
 * so the encoded-run pattern reaches neither the whole value nor any part of
 * it: only the bearer pattern can redact it.
 */
const BEARER_TOKEN = ['ya29.a0AfH6', 'SMB-short'].join('');
const BASIC_CREDENTIAL = ['YWRtaW46', 'c3VwZXJzZWNyZXQ='].join('');
const JSON_API_KEY = ['a1b2c3d4', 'e5f6a7b8', 'c9d0e1f2'].join('');

const LYRIC = 'moonlight on the water';
const REQUEST = `write a hook: ${LYRIC}, hold me till the morning`;
const ERROR_MESSAGE = `The provider rejected the request with ${CREDENTIAL} in the echoed header.`;
const CANCELLATION_REASON = `Stopped the run because ${LYRIC} was the wrong hook.`;
const DECISION_REASON = `Kept ${LYRIC} as the hook because the user asked for it.`;
const RENDER_SUMMARY = `Rendered ${LYRIC} to a stem.`;

const RUN_ID = 'run-redaction-fixture';
const CREATED_AT = 1000;
const CANCELLED_AT = 1600;

/** The one request id both attempts disclosed, so deduplication is observable. */
const REQUEST_ID = 'req-hook-0001';

/** A run at the encoded-run threshold, and the same run one character short. */
const THRESHOLD_RUN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
const BELOW_THRESHOLD_RUN = THRESHOLD_RUN.slice(0, -1);

/**
 * Every leaf the telemetry tier may carry: identifiers, enum literals,
 * revisions and route names. A free-text leaf fails it by carrying a character
 * outside the set or a run of words no identifier has.
 */
const IDENTIFIER_LEAF = new RegExp('^[A-Za-z0-9 ._:@/+=-]{1,256}$');
const FOUR_WORD_RUN = /(?:\S+\s+){3}\S+/;

const SCOPE: AgentRunScope = {
    targetIds: ['track-hook', 'track-bridge'],
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

const BUDGETS = { limits: { providerTokens: 4000 }, consumed: { providerTokens: 1500 } };

const RETENTION = {
    applicationState: 'unknown',
    abuseMonitoring: 'unknown',
    promptCache: 'unknown',
    safetyLegalException: 'unknown',
    unknown: 'unknown',
} as const;

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

/**
 * A run carrying two provider attempts that disclosed the same request id under
 * different correlation ids, two command batches, a pending, a completed and a
 * failed render, a completed analysis, a decision reason, an error message and
 * a cancellation reason.
 */
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
        budgets: BUDGETS,
        plan: PLAN,
        recordedAt: 1100,
    });
    agentRunLifecycle.recordDecision({
        runId: RUN_ID,
        decision: {
            decisionId: 'decision-hook',
            capabilitySchemaIdentity: 'capability-schema-hook',
            proposalIdentity: 'proposal-hook',
            budgets: BUDGETS,
            revision: 'heads-redaction-planned',
            scope: SCOPE,
            grants: GRANTS,
            alternatives: [],
            reason: DECISION_REASON,
            selectedAlternativeId: null,
            resumeAttemptId: null,
        },
        recordedAt: 1150,
    });
    agentRunLifecycle.recordProviderUsage({
        runId: RUN_ID,
        usage: {
            attempt: 1,
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
            disclosure: { requestId: REQUEST_ID, categories: ['prompt-text', 'lyrics'], retention: RETENTION },
        },
        recordedAt: 1200,
    });
    agentRunLifecycle.recordProviderUsage({
        runId: RUN_ID,
        usage: {
            attempt: 2,
            provider: 'webllm',
            model: 'llama-3-8b',
            inputTokens: 300,
            outputTokens: 60,
            cachedInputTokens: null,
            provenance: 'versioned-estimate',
            correlationId: 'correlation-hook-2',
            status: 'failed',
            routeId: 'route-local-2',
            executor: 'webllm',
            fallbackReason: 'provider-rate-limited',
            disclosure: { requestId: REQUEST_ID, categories: ['prompt-text'], retention: RETENTION },
        },
        recordedAt: 1250,
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
    // Recorded after the commit so the committed batch keeps its own status:
    // cancellation below moves every other batch to `cancelled`.
    agentRunLifecycle.recordBatch({
        runId: RUN_ID,
        batch: {
            batchId: 'batch-bridge',
            commandIds: ['command-bridge-1', 'command-bridge-2'],
            status: 'planned',
            receiptIdentity: null,
        },
        recordedAt: 1420,
    });
    agentRunLifecycle.recordArtifact({
        runId: RUN_ID,
        kind: 'render',
        artifact: {
            artifactId: 'render-hook-stem',
            workId: 'batch-hook',
            status: 'completed',
            summary: RENDER_SUMMARY,
        },
        recordedAt: 1440,
    });
    agentRunLifecycle.recordArtifact({
        runId: RUN_ID,
        kind: 'render',
        artifact: { artifactId: 'render-hook-bounce', workId: 'batch-bridge', status: 'pending', summary: null },
        recordedAt: 1460,
    });
    agentRunLifecycle.recordArtifact({
        runId: RUN_ID,
        kind: 'render',
        artifact: { artifactId: 'render-bridge-stem', workId: 'batch-bridge', status: 'failed', summary: null },
        recordedAt: 1465,
    });
    agentRunLifecycle.recordArtifact({
        runId: RUN_ID,
        kind: 'analysis',
        artifact: { artifactId: 'analysis-hook-loudness', workId: 'batch-hook', status: 'completed', summary: null },
        recordedAt: 1470,
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

function requirePlan(run: AgentRun): AgentRunPlan {
    const plan = run.plan;
    if (!plan) {
        throw new Error('Expected the recorded plan.');
    }
    return plan;
}

function requireDecisionReason(run: AgentRun): string {
    const decision = run.decision;
    if (!decision) {
        throw new Error('Expected the recorded decision.');
    }
    return decision.reason;
}

describe('redactSecrets', () => {
    it('replaces a bearer token and keeps its label', () => {
        expect(redactSecrets(`Bearer ${BEARER_TOKEN}`)).toEqual({
            text: 'Bearer [redacted]',
            redactedCount: 1,
        });
    });

    it('replaces a basic authorization value and keeps its label', () => {
        expect(redactSecrets(`curl -H "Authorization: Basic ${BASIC_CREDENTIAL}" https://gw/v1`)).toEqual({
            text: 'curl -H "Authorization: Basic [redacted]" https://gw/v1',
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

    it('replaces a labelled key whatever its case', () => {
        expect(redactSecrets(`API_KEY=${'f'.repeat(40)}`)).toEqual({
            text: 'API_KEY=[redacted]',
            redactedCount: 1,
        });
        // Shorter than the encoded-run threshold, so only the labelled pattern
        // can reach it.
        expect(redactSecrets('API_KEY=short-value-9')).toEqual({
            text: 'API_KEY=[redacted]',
            redactedCount: 1,
        });
    });

    it('replaces a quoted key inside a json body', () => {
        expect(redactSecrets(`request body was ${JSON.stringify({ apiKey: JSON_API_KEY })}`)).toEqual({
            text: `request body was ${JSON.stringify({ apiKey: '[redacted]' })}`,
            redactedCount: 1,
        });
    });

    it('consumes a quoted labelled value to its closing quote', () => {
        const spacedValue = 'correct horse battery staple';
        expect(redactSecrets(`{"password": ${JSON.stringify(spacedValue)}}`)).toEqual({
            text: '{"password": "[redacted]"}',
            redactedCount: 1,
        });
        // A single-quoted value whose own words carry a label of the list.
        const labelledPhrase = ['my secret', ' pass phrase'].join('');
        expect(redactSecrets(`password: '${labelledPhrase}'`)).toEqual({
            text: "password: '[redacted]'",
            redactedCount: 1,
        });
    });

    it('replaces a label an underscore precedes', () => {
        const repeatedValue = 'abc123'.repeat(2);
        expect(redactSecrets(`refresh_token=${repeatedValue}`)).toEqual({
            text: 'refresh_token=[redacted]',
            redactedCount: 1,
        });
        expect(redactSecrets('myapp_password=hunter2')).toEqual({
            text: 'myapp_password=[redacted]',
            redactedCount: 1,
        });
    });

    it('keeps the remaining query-string parameters beside a redacted one', () => {
        expect(redactSecrets('https://api.example.com/v1?access_token=X&user=jo')).toEqual({
            text: 'https://api.example.com/v1?access_token=[redacted]&user=jo',
            redactedCount: 1,
        });
    });

    it('leaves an already redacted value alone', () => {
        expect(redactSecrets('api_key: [redacted]')).toEqual({ text: 'api_key: [redacted]', redactedCount: 0 });
    });

    it('counts each labelled value one text carries', () => {
        const repeatedValue = 'aaa111'.repeat(2);
        expect(redactSecrets(`api_key=${repeatedValue} password=ccc333`)).toEqual({
            text: 'api_key=[redacted] password=[redacted]',
            redactedCount: 2,
        });
    });

    it('replaces a base64 run a provider error echoed', () => {
        expect(
            redactSecrets(
                'Hosted AI 401: rejected credential k9Lm2/Qp4Rs7+Tv0Wx3/Yz6Ab9Cd2Ef5/Gh8Ij1Kl4+Mn7Op0Qr3St6Uv9Wx2Yz5A'
            )
        ).toEqual({ text: 'Hosted AI 401: rejected credential [redacted]', redactedCount: 1 });
    });

    it('replaces an aws access key id and its secret access key', () => {
        expect(
            redactSecrets('Bedrock creds are AKIAIOSFODNN7EXAMPLE / wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
        ).toEqual({ text: 'Bedrock creds are [redacted] / [redacted]', redactedCount: 2 });
    });

    it('replaces an encoded run at the length threshold and keeps a shorter one', () => {
        expect(redactSecrets(THRESHOLD_RUN)).toEqual({ text: '[redacted]', redactedCount: 1 });
        expect(redactSecrets(BELOW_THRESHOLD_RUN)).toEqual({ text: BELOW_THRESHOLD_RUN, redactedCount: 0 });
    });

    it('counts every shape it replaced in one text', () => {
        expect(redactSecrets(`Bearer ${BEARER_TOKEN} then sk-${'b'.repeat(20)}`)).toEqual({
            text: 'Bearer [redacted] then [redacted]',
            redactedCount: 2,
        });
    });

    it('leaves a token count field untouched', () => {
        expect(redactSecrets('inputTokens: 1200')).toEqual({ text: 'inputTokens: 1200', redactedCount: 0 });
    });

    it('leaves project text untouched', () => {
        expect(redactSecrets(LYRIC)).toEqual({ text: LYRIC, redactedCount: 0 });
    });

    it('accepts empty input', () => {
        expect(redactSecrets('')).toEqual({ text: '', redactedCount: 0 });
    });

    it('redacts a double-quoted value that carries a single quote', () => {
        const passwordValue = ['it', "'s-a-", 'secret'].join('');
        expect(redactSecrets(JSON.stringify({ password: passwordValue }))).toEqual({
            text: '{"password":"[redacted]"}',
            redactedCount: 1,
        });
    });

    it('redacts a single-quoted value that carries a double quote', () => {
        const quotedValue = ['say "hi"', ' now'].join('');
        expect(redactSecrets(`token: '${quotedValue}'`)).toEqual({
            text: "token: '[redacted]'",
            redactedCount: 1,
        });
    });

    it('falls back to the unquoted entry when a quoted value has no closing quote', () => {
        expect(redactSecrets('password: "abc')).toEqual({
            text: 'password: "[redacted]',
            redactedCount: 1,
        });
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

    it('names its tier in each projection', () => {
        const run = createFixtureRun();

        expect(projectAgentRunTelemetry(run).tier).toBe('telemetry');
        expect(projectAgentRunDiagnostics(run).tier).toBe('diagnostics');
    });

    it('reports the run identity and every provider attempt in order', () => {
        const run = createFixtureRun();

        const record = projectAgentRunTelemetry(run);

        expect(record.runId).toBe(run.runId);
        expect(record.revisions).toEqual(run.revisions);
        expect(record.mode).toBe(run.mode);
        expect(record.finalStatus).toBe(run.phase);
        expect(record.provider).toEqual([
            {
                attempt: 1,
                provider: 'anthropic',
                model: 'claude-sonnet-4-5',
                routeId: 'route-cloud-1',
                executor: 'cloud',
                status: 'complete',
                fallbackReason: 'provider-timeout',
                provenance: 'provider-reported',
            },
            {
                attempt: 2,
                provider: 'webllm',
                model: 'llama-3-8b',
                routeId: 'route-local-2',
                executor: 'webllm',
                status: 'failed',
                fallbackReason: 'provider-rate-limited',
                provenance: 'versioned-estimate',
            },
        ]);
    });

    it('deduplicates the disclosed request ids and keeps every correlation id', () => {
        const record = projectAgentRunTelemetry(createFixtureRun());

        expect(record.correlation.requestIds).toEqual([REQUEST_ID]);
        expect(record.correlation.correlationIds).toEqual(['correlation-hook-1', 'correlation-hook-2']);
    });

    it('counts the plan steps, command batches and receipts', () => {
        const run = createFixtureRun();
        const plan = requirePlan(run);

        const record = projectAgentRunTelemetry(run);

        expect(record.plan?.stepCount).toBe(plan.steps.length);
        expect(record.plan?.actionTypes).toEqual(plan.steps.map((step) => step.actionType));
        expect(record.commands).toEqual({
            batchCount: 2,
            batchStatuses: ['committed', 'cancelled'],
            commandCount: 5,
        });
        expect(record.receipts.count).toBe(1);
    });

    it('counts each artifact under its own status', () => {
        const record = projectAgentRunTelemetry(createFixtureRun());

        expect(record.artifacts).toEqual({
            renders: { pending: 1, completed: 1, failed: 1 },
            analyses: { pending: 0, completed: 1, failed: 0 },
        });
    });

    it('reports the scope counts, approval points, cancellation, schema version and errors', () => {
        const record = projectAgentRunTelemetry(createFixtureRun());

        expect(record.schemaVersion).toBe(1);
        expect(record.scope).toEqual({
            targetIdCount: 2,
            protectedTargetIdCount: 1,
            targetRangeCount: 1,
            protectedRangeCount: 0,
        });
        expect(record.plan?.approvalPointKinds).toEqual(['command-confirmation']);
        expect(record.cancellation).toEqual({ requested: true, reason: null });
        expect(record.errors).toEqual([
            { code: 'provider-response-invalid', category: 'provider', retriable: true, occurredAt: 1500 },
        ]);
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

        expect(projectAgentRunTelemetry(run).costs).toEqual({
            inputTokens: 1500,
            outputTokens: 400,
            cachedInputTokens: 96,
            budgetLimits: { providerTokens: 4000 },
            budgetConsumed: { providerTokens: 1500 },
        });
        expect(projectAgentRunTelemetry(unreported).costs).toMatchObject({
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
        });
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
        const plan = requirePlan(run);

        const record = projectAgentRunDiagnostics(run);

        expect(containsCredential(record)).toBe(false);
        expect(JSON.stringify(record)).not.toContain('moonlight');
        expect(record.detail.request).toEqual({ kind: 'withheld', length: run.request.length });
        expect(record.detail.planDescriptions).toEqual(
            plan.steps.map((step) => ({ kind: 'withheld', length: step.description.length }))
        );
        expect(record.detail.decisionReason).toEqual({
            kind: 'withheld',
            length: requireDecisionReason(run).length,
        });
        expect(record.detail.errorMessages[0]?.kind).toBe('withheld');
        expect(record.detail.cancellationReason).toEqual({
            kind: 'withheld',
            length: CANCELLATION_REASON.length,
        });
    });

    it('carries redacted detail text when project content is requested', () => {
        const run = createFixtureRun();
        const plan = requirePlan(run);

        const record = projectAgentRunDiagnostics(run, { includeProjectContent: true });
        const request = record.detail.request;
        const errorMessage = record.detail.errorMessages[0];
        const decisionReason = record.detail.decisionReason;

        expect(request.kind).toBe('text');
        expect(request.kind === 'text' ? request.text : '').toContain(LYRIC);
        expect(record.detail.planDescriptions.map((entry) => (entry.kind === 'text' ? entry.text : null))).toEqual(
            plan.steps.map((step) => step.description)
        );
        expect(decisionReason?.kind === 'text' ? decisionReason.text : null).toBe(requireDecisionReason(run));
        expect(errorMessage?.kind === 'text' ? errorMessage.text : '').toContain('[redacted]');
        expect(errorMessage?.kind === 'text' ? errorMessage.secretsRedacted : 0).toBe(1);
        expect(containsCredential(record)).toBe(false);
    });

    it('returns fresh objects and leaves the run unchanged', () => {
        const run = createFixtureRun();
        const snapshot = structuredClone(run);

        const record = projectAgentRunTelemetry(run);
        projectAgentRunDiagnostics(run, { includeProjectContent: true });

        expect(record.revisions).not.toBe(run.revisions);
        expect(record.grants).not.toBe(run.grants);
        expect(record.grants).toEqual(run.grants);
        expect(record.modelRoute).not.toBe(run.modelRoute);
        expect(record.modelRoute).toEqual(run.modelRoute);
        expect(record.costs.budgetLimits).not.toBe(run.budgets.limits);
        expect(record.costs.budgetLimits).toEqual(run.budgets.limits);
        expect(record.costs.budgetConsumed).not.toBe(run.budgets.consumed);
        expect(record.costs.budgetConsumed).toEqual(run.budgets.consumed);
        expect(run).toEqual(snapshot);
    });
});
