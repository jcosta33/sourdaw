import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import { type ModelProviderResult } from '../models/ModelProviderProtocol';

import { agentRunLifecycle } from './agentRunLifecycle';

/**
 * Hosted tool-planning fields carry absence-vs-false/null meaning, so they are recorded only
 * when reported. Neutral usage owns cache-write attribution when it supplies a number or null;
 * the result-level extension remains a compatibility fallback for older callers.
 */
function optionalHostedUsageFields(
    result: ModelProviderResult
): Partial<{ strictToolSchemas: boolean; cacheWriteInputTokens: number | null }> {
    const fields: Partial<{ strictToolSchemas: boolean; cacheWriteInputTokens: number | null }> = {};
    if (result.strictToolSchemas !== undefined) {
        fields.strictToolSchemas = result.strictToolSchemas;
    }
    if (result.usage.cacheWriteInputTokens !== undefined) {
        fields.cacheWriteInputTokens = result.usage.cacheWriteInputTokens;
    } else if (result.cacheWriteInputTokens !== undefined) {
        fields.cacheWriteInputTokens = result.cacheWriteInputTokens;
    }
    return fields;
}

function prepareProviderUsageBudget(input: {
    runId: string;
    budgetAttemptId: string;
    executor: RunnableAiBackend;
    usage: ModelProviderResult['usage'];
}): { consumed: number; mode: 'cumulative' | 'final'; provenance: ModelProviderResult['usage']['provenance'] } | null {
    const existingAttempt = agentRunLifecycle
        .get(input.runId)
        ?.budgetAttempts.find((attempt) => attempt.attemptId === input.budgetAttemptId);
    if (existingAttempt?.final) {
        return null;
    }
    // WebLLM has no provider usage wire, so unavailable counters cannot turn every local planning
    // attempt's admission ceiling into permanent cumulative spend. Hosted attempts retain the
    // ceiling until both provider-billed counters are known.
    const canFinalizeUsage =
        input.executor === 'webllm' || (input.usage.inputTokens !== null && input.usage.outputTokens !== null);
    const knownUsage = (input.usage.inputTokens ?? 0) + (input.usage.outputTokens ?? 0);
    if (!existingAttempt) {
        agentRunLifecycle.reserveBudget({
            runId: input.runId,
            attemptId: input.budgetAttemptId,
            category: input.executor === 'cloud' ? 'remoteTokens' : 'localAnalysis',
            estimate: knownUsage,
            provenance: canFinalizeUsage ? input.usage.provenance : 'unavailable',
        });
    }
    return {
        consumed: knownUsage,
        mode: canFinalizeUsage ? 'final' : 'cumulative',
        provenance: canFinalizeUsage ? input.usage.provenance : (existingAttempt?.provenance ?? 'unavailable'),
    };
}

export function recordAgentProviderUsage(
    runId: string,
    result: ModelProviderResult,
    budgetAttemptId: string,
    options: { terminal: boolean } = { terminal: false }
): void {
    const executor: RunnableAiBackend = result.provider === 'webllm' ? 'webllm' : 'cloud';
    const routeId = `${executor}:${result.provider}:${result.model ?? 'unknown'}`;
    const budget = prepareProviderUsageBudget({ runId, budgetAttemptId, executor, usage: result.usage });
    if (budget === null) {
        return;
    }
    agentRunLifecycle.recordProviderUsage({
        runId,
        usage: {
            provider: result.provider,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
            provenance: result.usage.provenance,
            correlationId: result.correlationId,
            status: result.status,
            retryable: result.failure?.retryable ?? null,
            partialOutputDisposition: result.partialOutputDisposition,
            routeId,
            executor,
            ...(result.remoteDisclosure ? { disclosure: result.remoteDisclosure } : {}),
            ...optionalHostedUsageFields(result),
            fallbackReason:
                options.terminal || result.status === 'complete' ? null : (result.failure?.code ?? result.status),
        },
    });
    agentRunLifecycle.reconcileBudgetAttempt({
        runId,
        attemptId: budgetAttemptId,
        ...budget,
    });
}
