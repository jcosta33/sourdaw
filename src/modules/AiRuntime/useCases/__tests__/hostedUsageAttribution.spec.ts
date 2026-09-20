import { afterEach, describe, expect, it } from 'vitest';

import { MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION, type ModelProviderResult } from '../../models/ModelProviderProtocol';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProviderRouteView } from '../getProviderRouteView';
import { recordAgentProviderUsage } from '../recordAgentProviderUsage';

const RUN_ID = 'run-hosted-usage';
const BUDGET_ATTEMPT_ID = 'attempt-hosted-usage';

function createRun(budgets?: { limits: Record<string, number>; consumed: Record<string, number> }): void {
    const input: Parameters<typeof agentRunLifecycle.create>[0] = {
        runId: RUN_ID,
        request: 'set the tempo',
        mode: 'plan',
        createdRevision: null,
        requestedRoute: 'cloud',
    };
    if (budgets !== undefined) {
        input.budgets = budgets;
    }
    agentRunLifecycle.create(input);
}

function providerResult(input: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedInputTokens?: number | null;
    usageCacheWriteInputTokens?: number | null;
    legacyCacheWriteInputTokens?: number | null;
    status?: 'complete' | 'partial' | 'failed' | 'cancelled';
    correlationId?: string;
}): ModelProviderResult {
    const status = input.status ?? 'complete';
    const usage: ModelProviderResult['usage'] = {
        inputTokens: input.inputTokens ?? (Object.hasOwn(input, 'inputTokens') ? null : 63),
        outputTokens: input.outputTokens ?? (Object.hasOwn(input, 'outputTokens') ? null : 9),
        cachedInputTokens: input.cachedInputTokens ?? (Object.hasOwn(input, 'cachedInputTokens') ? null : 5),
        reasoningTokens: null,
        provenance: 'provider-reported',
    };
    if (Object.hasOwn(input, 'usageCacheWriteInputTokens')) {
        usage.cacheWriteInputTokens = input.usageCacheWriteInputTokens ?? null;
    }
    const result: ModelProviderResult = {
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        provider: 'anthropic',
        model: 'hosted-model',
        correlationId: input.correlationId ?? 'correlation-hosted-usage',
        status,
        output: { text: '', reasoning: '', toolCalls: [], structuredOutput: null },
        usage,
        finishReason: 'stop',
        partialOutputDisposition: 'none',
        failure: null,
        ignoredProviderEvents: [],
    };
    if (status === 'failed') {
        result.finishReason = 'error';
        result.partialOutputDisposition = 'discard';
        result.failure = {
            code: 'tool-planning-rejected',
            correlationId: 'correlation-hosted-usage',
            retryable: false,
            safeMessage: 'The model provider rejected tool planning.',
            partialOutputDisposition: 'discard',
        };
    } else if (status === 'cancelled') {
        result.finishReason = 'cancelled';
        result.partialOutputDisposition = 'discard';
    }
    if (Object.hasOwn(input, 'legacyCacheWriteInputTokens')) {
        result.cacheWriteInputTokens = input.legacyCacheWriteInputTokens ?? null;
    }
    return result;
}

describe('hosted usage attribution', () => {
    afterEach(() => {
        agentRunLifecycle.clear();
    });

    it('records inclusive input once and gives the neutral usage field precedence over the legacy extension', () => {
        createRun();

        recordAgentProviderUsage(
            RUN_ID,
            providerResult({ usageCacheWriteInputTokens: 8, legacyCacheWriteInputTokens: 99 }),
            BUDGET_ATTEMPT_ID
        );

        expect(agentRunLifecycle.get(RUN_ID)?.providerUsage[0]).toMatchObject({
            inputTokens: 63,
            outputTokens: 9,
            cachedInputTokens: 5,
            cacheWriteInputTokens: 8,
            provenance: 'provider-reported',
        });
        expect(agentRunLifecycle.get(RUN_ID)?.budgetAttempts[0]).toMatchObject({
            category: 'remoteTokens',
            reserved: 72,
            actual: 72,
            final: true,
        });
    });

    it('keeps an admitted estimate reserved when a required provider counter is unknown', () => {
        createRun();
        agentRunLifecycle.reserveBudget({
            runId: RUN_ID,
            attemptId: BUDGET_ATTEMPT_ID,
            category: 'remoteTokens',
            estimate: 100,
            provenance: 'versioned-estimate',
            estimateMethod: 'compiled-provider-request-utf8-byte-token-ceiling-v1',
        });

        recordAgentProviderUsage(
            RUN_ID,
            providerResult({ inputTokens: null, outputTokens: 9, usageCacheWriteInputTokens: 8 }),
            BUDGET_ATTEMPT_ID
        );

        expect(agentRunLifecycle.get(RUN_ID)?.budgetAttempts[0]).toEqual({
            attemptId: BUDGET_ATTEMPT_ID,
            category: 'remoteTokens',
            reserved: 100,
            actual: 9,
            provenance: 'versioned-estimate',
            estimateMethod: 'compiled-provider-request-utf8-byte-token-ceiling-v1',
            final: false,
        });
        expect(agentRunLifecycle.get(RUN_ID)?.budgets.consumed.remoteTokens).toBe(100);
        expect(getProviderRouteView({ runId: RUN_ID })?.usage).toMatchObject({
            provenance: 'unavailable',
            inputTokens: null,
            outputTokens: 9,
            cachedInputTokens: 5,
        });
    });

    it('settles completed WebLLM attempts without claiming unavailable token counts were measured', () => {
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: 'set the tempo',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'webllm',
            budgets: { limits: { localAnalysis: 100 }, consumed: {} },
        });
        agentRunLifecycle.reserveBudget({
            runId: RUN_ID,
            attemptId: BUDGET_ATTEMPT_ID,
            category: 'localAnalysis',
            estimate: 100,
            provenance: 'versioned-estimate',
        });
        const result = providerResult({ inputTokens: null, outputTokens: null });

        recordAgentProviderUsage(
            RUN_ID,
            {
                ...result,
                provider: 'webllm',
                model: 'webllm-model',
                usage: { ...result.usage, provenance: 'unavailable' },
            },
            BUDGET_ATTEMPT_ID
        );

        expect(agentRunLifecycle.get(RUN_ID)?.providerUsage[0]).toMatchObject({
            inputTokens: null,
            outputTokens: null,
            provenance: 'unavailable',
        });
        expect(agentRunLifecycle.get(RUN_ID)?.budgetAttempts[0]).toMatchObject({
            category: 'localAnalysis',
            reserved: 100,
            actual: 0,
            provenance: 'unavailable',
            final: true,
        });
        expect(agentRunLifecycle.get(RUN_ID)?.budgets.consumed.localAnalysis).toBe(0);
        expect(
            agentRunLifecycle.reserveBudget({
                runId: RUN_ID,
                attemptId: 'next-webllm-attempt',
                category: 'localAnalysis',
                estimate: 100,
                provenance: 'versioned-estimate',
            })
        ).toEqual({ status: 'reserved' });
    });

    it('keeps the estimate when output usage is unknown', () => {
        createRun();
        agentRunLifecycle.reserveBudget({
            runId: RUN_ID,
            attemptId: BUDGET_ATTEMPT_ID,
            category: 'remoteTokens',
            estimate: 100,
            provenance: 'versioned-estimate',
        });

        recordAgentProviderUsage(RUN_ID, providerResult({ inputTokens: 63, outputTokens: null }), BUDGET_ATTEMPT_ID);

        expect(agentRunLifecycle.get(RUN_ID)?.budgetAttempts[0]).toMatchObject({
            reserved: 100,
            actual: 63,
            provenance: 'versioned-estimate',
            final: false,
        });
        expect(agentRunLifecycle.get(RUN_ID)?.budgets.consumed.remoteTokens).toBe(100);
        expect(getProviderRouteView({ runId: RUN_ID })?.usage).toMatchObject({
            provenance: 'unavailable',
            inputTokens: 63,
            outputTokens: null,
        });
    });

    it('settles an explicit zero input counter as complete provider usage', () => {
        createRun();
        agentRunLifecycle.reserveBudget({
            runId: RUN_ID,
            attemptId: BUDGET_ATTEMPT_ID,
            category: 'remoteTokens',
            estimate: 100,
            provenance: 'versioned-estimate',
        });

        recordAgentProviderUsage(RUN_ID, providerResult({ inputTokens: 0, outputTokens: 9 }), BUDGET_ATTEMPT_ID);

        expect(agentRunLifecycle.get(RUN_ID)?.budgetAttempts[0]).toMatchObject({
            reserved: 100,
            actual: 9,
            provenance: 'provider-reported',
            final: true,
        });
        expect(agentRunLifecycle.get(RUN_ID)?.budgets.consumed.remoteTokens).toBe(9);
    });

    it('settles later complete usage once and does not let a later partial report reduce the charge', () => {
        createRun();
        agentRunLifecycle.reserveBudget({
            runId: RUN_ID,
            attemptId: BUDGET_ATTEMPT_ID,
            category: 'remoteTokens',
            estimate: 100,
            provenance: 'versioned-estimate',
        });
        recordAgentProviderUsage(RUN_ID, providerResult({ inputTokens: null, outputTokens: 9 }), BUDGET_ATTEMPT_ID);
        const complete = providerResult({ inputTokens: 63, outputTokens: 9 });

        recordAgentProviderUsage(RUN_ID, complete, BUDGET_ATTEMPT_ID);
        recordAgentProviderUsage(RUN_ID, complete, BUDGET_ATTEMPT_ID);
        recordAgentProviderUsage(
            RUN_ID,
            providerResult({ inputTokens: null, outputTokens: 4, status: 'partial' }),
            BUDGET_ATTEMPT_ID
        );

        expect(agentRunLifecycle.get(RUN_ID)?.budgetAttempts[0]).toMatchObject({
            reserved: 100,
            actual: 72,
            provenance: 'provider-reported',
            final: true,
        });
        expect(agentRunLifecycle.get(RUN_ID)?.budgets.consumed.remoteTokens).toBe(72);
        expect(agentRunLifecycle.get(RUN_ID)?.providerUsage).toHaveLength(1);
        expect(getProviderRouteView({ runId: RUN_ID })?.usage).toMatchObject({
            provenance: 'provider-reported',
            inputTokens: 63,
            outputTokens: 9,
        });
    });

    it('marks incomplete unreserved usage unavailable instead of inventing an estimate', () => {
        createRun();

        recordAgentProviderUsage(RUN_ID, providerResult({ inputTokens: null, outputTokens: 9 }), BUDGET_ATTEMPT_ID);

        expect(agentRunLifecycle.get(RUN_ID)?.budgetAttempts[0]).toEqual({
            attemptId: BUDGET_ATTEMPT_ID,
            category: 'remoteTokens',
            reserved: 9,
            actual: 9,
            provenance: 'unavailable',
            final: false,
        });
    });

    it('retains cancelled usage reservations while admitting only a fallback within the remaining ceiling', () => {
        createRun({ limits: { remoteTokens: 150 }, consumed: {} });
        agentRunLifecycle.reserveBudget({
            runId: RUN_ID,
            attemptId: BUDGET_ATTEMPT_ID,
            category: 'remoteTokens',
            estimate: 100,
            provenance: 'versioned-estimate',
        });
        recordAgentProviderUsage(
            RUN_ID,
            providerResult({ inputTokens: null, outputTokens: 9, status: 'cancelled' }),
            BUDGET_ATTEMPT_ID
        );

        expect(
            agentRunLifecycle.reserveBudget({
                runId: RUN_ID,
                attemptId: 'fallback-within-ceiling',
                category: 'remoteTokens',
                estimate: 50,
                provenance: 'versioned-estimate',
            })
        ).toEqual({ status: 'reserved' });
        expect(
            agentRunLifecycle.reserveBudget({
                runId: RUN_ID,
                attemptId: 'fallback-over-ceiling',
                category: 'remoteTokens',
                estimate: 1,
                provenance: 'versioned-estimate',
            })
        ).toEqual({ status: 'hard-limit-reached', reason: 'remoteTokens' });
    });

    it('preserves explicit null and zero from neutral usage without falling back to the legacy extension', () => {
        createRun();
        recordAgentProviderUsage(
            RUN_ID,
            providerResult({ usageCacheWriteInputTokens: null, legacyCacheWriteInputTokens: 8 }),
            'attempt-null'
        );
        expect(agentRunLifecycle.get(RUN_ID)?.providerUsage[0]).toMatchObject({ cacheWriteInputTokens: null });

        recordAgentProviderUsage(
            RUN_ID,
            providerResult({ usageCacheWriteInputTokens: 0, legacyCacheWriteInputTokens: 8 }),
            'attempt-zero'
        );
        expect(agentRunLifecycle.get(RUN_ID)?.providerUsage[0]).toMatchObject({ cacheWriteInputTokens: 0 });
    });

    it('uses the legacy extension only when neutral usage omits the counter', () => {
        createRun();
        recordAgentProviderUsage(
            RUN_ID,
            providerResult({ legacyCacheWriteInputTokens: 8, status: 'failed' }),
            BUDGET_ATTEMPT_ID
        );

        expect(agentRunLifecycle.get(RUN_ID)?.providerUsage[0]).toMatchObject({
            status: 'failed',
            retryable: false,
            cacheWriteInputTokens: 8,
        });
    });

    it('keeps the optional cache-write counter absent when neither result surface reports it', () => {
        createRun();
        recordAgentProviderUsage(RUN_ID, providerResult({}), BUDGET_ATTEMPT_ID);

        expect(agentRunLifecycle.get(RUN_ID)?.providerUsage[0]).not.toHaveProperty('cacheWriteInputTokens');
    });
});
