import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import { type ModelProviderResult } from '../models/ModelProviderProtocol';

import { agentRunLifecycle } from './agentRunLifecycle';

export function recordAgentProviderUsage(
    runId: string,
    result: ModelProviderResult,
    budgetAttemptId: string,
    options: { terminal: boolean } = { terminal: false }
): void {
    const executor: RunnableAiBackend = result.provider === 'webllm' ? 'webllm' : 'cloud';
    const routeId = `${executor}:${result.provider}:${result.model ?? 'unknown'}`;
    const existingAttempt = agentRunLifecycle
        .get(runId)
        ?.budgetAttempts.some((attempt) => attempt.attemptId === budgetAttemptId);
    if (!existingAttempt) {
        agentRunLifecycle.reserveBudget({
            runId,
            attemptId: budgetAttemptId,
            category: executor === 'cloud' ? 'remoteTokens' : 'localAnalysis',
            estimate: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
            provenance: result.usage.provenance,
        });
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
            fallbackReason:
                options.terminal || result.status === 'complete' ? null : (result.failure?.code ?? result.status),
        },
    });
    agentRunLifecycle.reconcileBudgetAttempt({
        runId,
        attemptId: budgetAttemptId,
        consumed: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
        mode: 'final',
        provenance: result.usage.provenance,
    });
}
