import { afterEach, describe, expect, it } from 'vitest';

import { MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION, type ModelProviderResult } from '../../models/ModelProviderProtocol';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recordAgentProviderUsage } from '../recordAgentProviderUsage';

const RUN_ID = 'run-hosted-usage';
const BUDGET_ATTEMPT_ID = 'attempt-hosted-usage';

function createRun(): void {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: 'set the tempo',
        mode: 'plan',
        createdRevision: null,
        requestedRoute: 'cloud',
    });
}

function providerResult(input: {
    usageCacheWriteInputTokens?: number | null;
    legacyCacheWriteInputTokens?: number | null;
    status?: 'complete' | 'failed';
}): ModelProviderResult {
    const status = input.status ?? 'complete';
    const usage: ModelProviderResult['usage'] = {
        inputTokens: 63,
        outputTokens: 9,
        cachedInputTokens: 5,
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
        correlationId: 'correlation-hosted-usage',
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
