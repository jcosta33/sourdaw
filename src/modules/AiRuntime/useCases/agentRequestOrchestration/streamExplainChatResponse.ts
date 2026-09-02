import { isAppError } from '#/infra/errors/isAppError';
import { logger } from '#/infra/logger/appLogger';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { isAiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import {
    assertRemoteAgentDataPolicy,
    formatRemoteTransmissionDisclosure,
    REMOTE_TEXT_AGENT_DATA_CATEGORIES,
} from '../../models/AgentDataPolicy';
import { type AgentRunWorkLease } from '../../models/AgentRun';
import { type ChatMessage } from '../../models/Chat';
import { CHAT_SYSTEM_PROMPT } from '../../models/ChatSystemPrompt';
import { type RunnableAiBackend } from '../../models/LlmOrchestrationTypes';
import { estimateCompiledProviderRequestTokenCeiling } from '../../models/ModelProviderBudgetEstimate';
import {
    type ModelProviderFinish,
    type ModelProviderName,
    type ModelProviderResult,
    type ModelProviderSession,
} from '../../models/ModelProviderProtocol';
import {
    type CloudChatCompletionOutcome,
    streamCloudChatCompletion,
} from '../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { getCloudProviderInfo } from '../../repositories/cloudLlm/getCloudProviderInfo';
import { isCloudAvailable } from '../../repositories/cloudLlm/isCloudAvailable';
import { getActiveModelId } from '../../repositories/webLlm/getActiveModelId';
import { getLlmEngine } from '../../repositories/webLlm/getLlmEngine';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import {
    chatStore,
    appendChatMessage,
    updateChatMessage,
    setChatGenerating,
    setActiveAborter,
} from '../../stores/chatStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { normalizeAgentFailure } from '../agentErrorAndSaga';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { buildAgentContext } from '../buildAgentContext';
import { agentRunCancellation } from '../cancelAgentRun';
import { createModelProviderStreamWriter } from '../createModelProviderStreamWriter';
import { createThinkBlockParser } from '../createThinkBlockParser';
import { remoteTransmissionDisclosure } from '../discloseRemoteTransmission';
import { getProjectContext } from '../getProjectContext';
import { createModelProviderProtocol } from '../modelProviderProtocol';
import { recordAgentProviderUsage } from '../recordAgentProviderUsage';

import { AGENT_RUN_STALE_COMPLETION_WARNING, settleAgentRunWorkLeaseSafely } from './settleAgentRunWorkLeaseSafely';

type StreamExplainChatResponseInput = {
    userText: string;
    runId: string;
    backend: RunnableAiBackend;
    providerLease: AgentRunWorkLease;
    providerReceiptIdentity: string;
    providerWorkId: string;
};

function getBackendModelId(backend: RunnableAiBackend): string {
    return backend === 'cloud' ? (getCloudProviderInfo()?.model ?? 'cloud') : getActiveModelId();
}

function getModelProviderName(backend: RunnableAiBackend): ModelProviderName {
    return backend === 'webllm' ? backend : (getCloudProviderInfo()?.provider ?? 'openai-compatible');
}

function getProviderDisplayName(backend: RunnableAiBackend): string {
    return backend === 'cloud' ? 'Hosted AI' : 'WebLLM';
}

function getProviderBudgetCategory(backend: RunnableAiBackend): string {
    return backend === 'cloud' ? 'remoteTokens' : 'localAnalysis';
}

function readProviderTokenCount(value: unknown): number | null {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}

function tryRecordTerminalFailure(input: Parameters<typeof agentRunLifecycle.recordError>[0]): void {
    try {
        agentRunLifecycle.recordError(input);
    } catch {
        // The user-visible failure remains authoritative when its recovery record cannot persist.
    }
}

function completeProviderResponseBestEffort(input: {
    lease: AgentRunWorkLease;
    result: ModelProviderResult;
    receiptIdentity: string;
}): ReturnType<typeof settleAgentRunWorkLeaseSafely> {
    const settlement = settleAgentRunWorkLeaseSafely({
        lease: input.lease,
        terminalState: 'completed',
        evidence: 'visible-provider-output',
        settle: agentRunWorkLease.settle,
        reportFailure: (error) =>
            logger.error(new Error('Completed provider work lease settlement failed', { cause: error })),
    });
    try {
        recordAgentProviderUsage(input.lease.runId, input.result, input.receiptIdentity, { terminal: true });
    } catch (error) {
        logger.error(new Error('Completed provider usage accounting failed', { cause: error }));
    }
    if (!settlement.accepted || settlement.warning !== null) {
        return settlement;
    }
    try {
        agentRunLifecycle.transitionPhase({ runId: input.lease.runId, phase: 'completed' });
    } catch (error) {
        logger.error(new Error('Completed provider lifecycle persistence failed', { cause: error }));
    }
    return settlement;
}

export async function streamExplainChatResponse(input: StreamExplainChatResponseInput): Promise<undefined> {
    const { userText, runId, backend, providerLease, providerReceiptIdentity, providerWorkId } = input;
    const userMsgId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({ id: userMsgId, role: 'user', content: userText, timestamp: Date.now() });

    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    const initialAssistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
    };
    appendChatMessage(initialAssistantMessage);

    const aborter = new AbortController();
    setActiveAborter(aborter);
    const releaseProviderCancellation = agentRunCancellation.bindAbortController({
        runId,
        lease: providerLease,
        controller: aborter,
        reason: 'User cancelled the run while the provider response was active.',
    });
    const previousLlmStatus = llmStatusStore.value;
    llmStatusStore.set({ state: 'generating' });
    const thinkParser = createThinkBlockParser();
    let cloudOutcome: CloudChatCompletionOutcome | null = null;
    let webLlmIncompleteReason: string | null = null;
    let providerSession: ModelProviderSession | null = null;
    let providerStreamWriter: ReturnType<typeof createModelProviderStreamWriter> | null = null;
    let providerResult: ModelProviderResult | null = null;
    let providerUsageRecorded = false;

    try {
        const workspaceContext = getProjectContext();
        const agentRun = agentRunLifecycle.get(runId);
        if (agentRun === null) {
            throw createAiRuntimeError('The agent run could not be recovered before provider planning.');
        }
        const agentContext = buildAgentContext({
            fixedPolicy: CHAT_SYSTEM_PROMPT,
            prompt: userText,
            context: workspaceContext,
            projectRevision: captureProjectRevision(),
            run: { grants: agentRun.grants, budgets: agentRun.budgets },
            receipts: (agentRun.plan?.applicationToolReceipts ?? []).map((receipt) => ({
                id: receipt.callId,
                summary: receipt.summary,
            })),
            validationFailures: agentRun.errors.map((error) => ({ code: error.code })),
            priorEvidence: agentRun.contextEvidence,
        });
        agentRunLifecycle.recordContextEvidence({ runId, evidence: agentContext.evidence });
        if (!agentContext.authorityComplete) {
            throw createAiRuntimeError('Relevant production authority exceeds the bounded context limit.');
        }
        const conversationHistory = chatStore
            .value!.messages.filter((message) => message.id !== assistantMsgId && !message.error)
            .slice(-24)
            .map((message) => ({ role: message.role, content: message.content }));
        const remoteDisclosure =
            backend === 'cloud'
                ? remoteTransmissionDisclosure.prepare({
                      categories: REMOTE_TEXT_AGENT_DATA_CATEGORIES,
                      correlationId: providerReceiptIdentity,
                      requestId: providerReceiptIdentity,
                  })
                : undefined;
        const providerProtocol = createModelProviderProtocol({
            provider: getModelProviderName(backend),
            model: getBackendModelId(backend),
        });
        const compiledProviderRequest = providerProtocol.compileRequest({
            correlationId: providerReceiptIdentity,
            runId,
            requestId: providerReceiptIdentity,
            cancellationGeneration: providerLease.cancellationGeneration,
            operation: 'text',
            modality: 'text',
            messages: [{ role: 'system', content: agentContext.message }, ...conversationHistory],
            stream: true,
            limits: { maxOutputTokens: 2_048 },
            controls: { cache: 'provider-default', reasoning: 'provider-default' },
            budget: { maxInputTokens: 32_768, maxOutputTokens: 2_048, maxTotalTokens: 34_816 },
            dataPolicy: backend === 'cloud' ? 'remote-allowed' : 'local-only',
            ...(remoteDisclosure === undefined
                ? {}
                : { dataCategories: [...REMOTE_TEXT_AGENT_DATA_CATEGORIES], remoteDisclosure }),
        });
        if (compiledProviderRequest.status !== 'ready') {
            throw createAiRuntimeError(compiledProviderRequest.failure.safeMessage);
        }
        const providerRequest = compiledProviderRequest.request;
        const providerEstimate = estimateCompiledProviderRequestTokenCeiling(providerRequest);
        const budgetReservation = agentRunLifecycle.reserveBudget({
            runId,
            attemptId: providerRequest.correlationId,
            category: getProviderBudgetCategory(backend),
            estimate: providerEstimate.totalTokenCeiling,
            provenance: 'versioned-estimate',
            estimateMethod: providerEstimate.method,
        });
        if (budgetReservation.status === 'hard-limit-reached') {
            agentRunLifecycle.recordError({
                runId,
                error: normalizeAgentFailure({
                    category: 'budget',
                    source: 'provider-planning',
                    related: { workIds: [providerWorkId] },
                    knownDomain: true,
                }),
                terminal: true,
            });
            throw createAiRuntimeError('The agent budget limit was reached before work started.');
        }
        if (backend === 'cloud') {
            if (
                remoteDisclosure === undefined ||
                !remoteTransmissionDisclosure.publish({
                    evidence: remoteDisclosure,
                    runId,
                    provider: getModelProviderName(backend),
                })
            ) {
                throw createAiRuntimeError('Hosted AI privacy disclosure could not be published.');
            }
            assertRemoteAgentDataPolicy(REMOTE_TEXT_AGENT_DATA_CATEGORIES);
            appendChatMessage({
                id: `msg-${crypto.randomUUID()}`,
                role: 'assistant',
                content: formatRemoteTransmissionDisclosure(REMOTE_TEXT_AGENT_DATA_CATEGORIES),
                timestamp: Date.now(),
            });
        }
        providerSession = providerProtocol.start(providerRequest);
        const activeProviderStreamWriter = createModelProviderStreamWriter(providerRequest, providerSession);
        providerStreamWriter = activeProviderStreamWriter;

        if (backend === 'cloud') {
            cloudOutcome = await streamCloudChatCompletion(
                providerRequest.messages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    activeProviderStreamWriter.push({ type: 'text', mode: 'delta', text: token });
                    const parsed = thinkParser.push(token);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                },
                {
                    temperature: 0.7,
                    maxTokens: providerRequest.limits.maxOutputTokens,
                    signal: aborter.signal,
                    onUsage: (event) => activeProviderStreamWriter.push(event),
                    onUnknownEvent: (providerEventType) =>
                        activeProviderStreamWriter.push({ type: 'unknown', providerEventType }),
                    // The system message here is agentContext.message: `fixed_policy:\n${CHAT_SYSTEM_PROMPT}`
                    // followed by run_authority, user_request, revision_and_selection, and other per-turn
                    // content, so the whole block differs every turn. Even the byte-stable `fixed_policy`
                    // prefix alone measures ~3.5KB / ~900-1000 estimated tokens — under Anthropic's ~1024
                    // token minimum cacheable-prefix breakpoint, with too little headroom for a prompt edit
                    // to keep clearing it. Marking any of this cacheable would pay a cache write every turn
                    // for a read that may never land, so the chat path opts out entirely.
                    cacheSystemPrompt: false,
                }
            );
        } else {
            await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
            aborter.signal.throwIfAborted();
            const engine = getLlmEngine()!;
            function interruptWebLlm(): void {
                engine.interruptGenerate();
            }
            aborter.signal.addEventListener('abort', interruptWebLlm, { once: true });

            try {
                const asyncChunkGenerator = (await engine.chat.completions.create({
                    messages: providerRequest.messages,
                    temperature: 0.7,
                    max_tokens: providerRequest.limits.maxOutputTokens,
                    stream: true,
                })) as AsyncIterable<{
                    choices?: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
                    type?: string;
                    usage?: {
                        prompt_tokens?: number;
                        completion_tokens?: number;
                        prompt_tokens_details?: { cached_tokens?: number };
                        completion_tokens_details?: { reasoning_tokens?: number };
                    };
                }>;
                let sawTerminalReason = false;
                let sawFinalUsage = false;

                for await (const chunk of asyncChunkGenerator) {
                    if (aborter.signal.aborted) {
                        break;
                    }
                    if (sawTerminalReason && !Array.isArray(chunk.choices)) {
                        throw new Error('WebLLM stream returned an event after completion');
                    }
                    if (!Array.isArray(chunk.choices)) {
                        activeProviderStreamWriter.push({
                            type: 'unknown',
                            providerEventType: `webllm:${chunk.type ?? 'unknown'}`,
                        });
                        continue;
                    }
                    const choice = chunk.choices[0];
                    const deltaDesc = choice?.delta.content;
                    if (sawTerminalReason) {
                        if (chunk.choices.length === 0 && chunk.usage && !sawFinalUsage) {
                            activeProviderStreamWriter.push({
                                type: 'usage',
                                mode: 'final',
                                usage: {
                                    inputTokens: readProviderTokenCount(chunk.usage.prompt_tokens),
                                    outputTokens: readProviderTokenCount(chunk.usage.completion_tokens),
                                    cachedInputTokens: readProviderTokenCount(
                                        chunk.usage.prompt_tokens_details?.cached_tokens
                                    ),
                                    reasoningTokens: readProviderTokenCount(
                                        chunk.usage.completion_tokens_details?.reasoning_tokens
                                    ),
                                },
                                provenance: 'provider-reported',
                            });
                            sawFinalUsage = true;
                            continue;
                        }
                        if (deltaDesc !== undefined) {
                            throw new Error('WebLLM stream returned text after completion');
                        }
                        if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
                            throw new Error('WebLLM stream returned duplicate completion');
                        }
                        throw new Error('WebLLM stream returned an event after completion');
                    }
                    if (chunk.choices.length === 0 && !chunk.usage) {
                        activeProviderStreamWriter.push({
                            type: 'unknown',
                            providerEventType: `webllm:${chunk.type ?? 'unknown'}`,
                        });
                    }
                    if (deltaDesc !== undefined) {
                        activeProviderStreamWriter.push({ type: 'text', mode: 'delta', text: deltaDesc });
                        const parsed = thinkParser.push(deltaDesc);
                        updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                    }
                    if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
                        sawTerminalReason = true;
                        if (choice.finish_reason !== 'stop') {
                            webLlmIncompleteReason = choice.finish_reason;
                        }
                    }
                    if (chunk.usage) {
                        activeProviderStreamWriter.push({
                            type: 'usage',
                            mode: 'final',
                            usage: {
                                inputTokens: readProviderTokenCount(chunk.usage.prompt_tokens),
                                outputTokens: readProviderTokenCount(chunk.usage.completion_tokens),
                                cachedInputTokens: readProviderTokenCount(
                                    chunk.usage.prompt_tokens_details?.cached_tokens
                                ),
                                reasoningTokens: readProviderTokenCount(
                                    chunk.usage.completion_tokens_details?.reasoning_tokens
                                ),
                            },
                            provenance: 'provider-reported',
                        });
                        sawFinalUsage = true;
                    }
                }
                if (!aborter.signal.aborted && !sawTerminalReason) {
                    throw new Error('WebLLM chat stream ended unexpectedly');
                }
            } finally {
                aborter.signal.removeEventListener('abort', interruptWebLlm);
            }
        }

        if (aborter.signal.aborted) {
            throw aborter.signal.reason;
        }
        let providerFinish: ModelProviderFinish = { reason: 'stop' };
        if (cloudOutcome?.status === 'incomplete') {
            providerFinish =
                cloudOutcome.reason === 'length' || cloudOutcome.reason === 'token limit'
                    ? { reason: 'length' }
                    : {
                          reason: 'error',
                          failure: {
                              code: 'incomplete-output',
                              retryable: true,
                              safeMessage: 'The hosted provider returned an incomplete response.',
                          },
                      };
        } else if (webLlmIncompleteReason !== null) {
            providerFinish =
                webLlmIncompleteReason === 'length'
                    ? { reason: 'length' }
                    : {
                          reason: 'error',
                          failure: {
                              code: 'incomplete-output',
                              retryable: true,
                              safeMessage: 'WebLLM returned an incomplete response.',
                          },
                      };
        }
        providerResult = activeProviderStreamWriter.finish(providerFinish);
        const { reasoning, content: cleanContent } = thinkParser.snapshot();
        const incompleteFailure =
            providerResult.failure !== null &&
            (providerResult.status === 'partial' || providerResult.status === 'failed')
                ? providerResult.failure
                : null;
        const incompleteReason =
            incompleteFailure?.code === 'output-limit' ? 'length' : (incompleteFailure?.code ?? null);
        const incompleteNotice =
            incompleteFailure === null ? '' : `\n\n_Response incomplete: ${incompleteFailure.safeMessage}_`;
        const incompleteError =
            incompleteReason === null
                ? undefined
                : `${getProviderDisplayName(backend)} response incomplete (${incompleteReason})`;
        updateChatMessage(assistantMsgId, {
            isStreaming: false,
            content: `${cleanContent}${incompleteNotice}`,
            reasoning,
            error: incompleteError,
        });
        const providerSettlement = completeProviderResponseBestEffort({
            lease: providerLease,
            result: providerResult,
            receiptIdentity: providerReceiptIdentity,
        });
        providerUsageRecorded = true;
        if (!providerSettlement.accepted || providerSettlement.warning !== null) {
            const warning = providerSettlement.warning ?? AGENT_RUN_STALE_COMPLETION_WARNING;
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: `${cleanContent}${incompleteNotice}\n\n_${warning}_`,
                reasoning,
                error: incompleteError === undefined ? warning : `${incompleteError}\n\n${warning}`,
            });
        }
        llmStatusStore.set({ state: 'ready', backend, modelId: getBackendModelId(backend) });
    } catch (error) {
        const errorMessage = (() => {
            if (isAppError(error)) {
                return error.message;
            }
            if (error instanceof Error) {
                return error.message;
            }
            return 'An unknown error occurred during generation.';
        })();
        const configurationChanged = isAiRuntimeConfigurationChangedError(error);
        const wasAborted =
            configurationChanged ||
            aborter.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError') ||
            errorMessage === 'AbortedByUser' ||
            errorMessage.includes('AbortError');
        if (providerSession && providerStreamWriter && !providerResult) {
            providerResult = providerStreamWriter.finish(
                wasAborted
                    ? { reason: 'cancelled' }
                    : {
                          reason: 'error',
                          failure: {
                              code: 'provider-stream-failed',
                              retryable: true,
                              safeMessage: 'The model provider request failed.',
                          },
                      }
            );
        }
        if (providerResult && !providerUsageRecorded) {
            try {
                recordAgentProviderUsage(runId, providerResult, providerReceiptIdentity, { terminal: true });
                providerUsageRecorded = true;
            } catch (usageError) {
                logger.error(new Error('Provider failure usage accounting failed', { cause: usageError }));
            }
        }
        if (configurationChanged) {
            await agentRunCancellation.cancel({ runId, reason: errorMessage });
            settleAgentRunWorkLeaseSafely({
                lease: providerLease,
                terminalState: 'cancelled',
                evidence: 'none',
                settle: agentRunWorkLease.settle,
            });
            const parsed = thinkParser.snapshot();
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: parsed.content,
                reasoning: parsed.reasoning,
                error: 'Hosted AI configuration changed; this response was cancelled.',
            });
            llmStatusStore.set({ state: 'idle' });
            return undefined;
        }
        const failedProviderOutput = thinkParser.snapshot();
        const providerFailureSettlement = !wasAborted
            ? settleAgentRunWorkLeaseSafely({
                  lease: providerLease,
                  terminalState: 'failed',
                  evidence:
                      failedProviderOutput.content.length > 0 || (failedProviderOutput.reasoning?.length ?? 0) > 0
                          ? 'visible-provider-output'
                          : 'none',
                  settle: agentRunWorkLease.settle,
                  reportFailure: (settlementError) =>
                      logger.error(
                          new Error('Failed provider work lease settlement failed', { cause: settlementError })
                      ),
              })
            : null;
        if (wasAborted) {
            await agentRunCancellation.cancel({ runId, reason: errorMessage });
            const parsed = failedProviderOutput;
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: parsed.content,
                reasoning: parsed.reasoning,
            });
            const currentPreference = aiBackendPreferenceStore.value ?? 'auto';
            if (currentPreference !== 'auto' && currentPreference !== backend) {
                llmStatusStore.set({ state: 'idle' });
            } else if (
                previousLlmStatus?.state === 'ready' &&
                previousLlmStatus.backend === 'cloud' &&
                !isCloudAvailable()
            ) {
                llmStatusStore.set({ state: 'idle' });
            } else {
                llmStatusStore.set(previousLlmStatus ?? { state: 'idle' });
            }
        } else {
            if (providerFailureSettlement?.accepted) {
                tryRecordTerminalFailure({
                    runId,
                    error: normalizeAgentFailure({
                        category: 'provider',
                        source: 'provider-planning',
                        retry: 'read-only',
                        knownDomain: false,
                    }),
                    terminal: true,
                });
            }
            const parsed = failedProviderOutput;
            const hasPartialContent = parsed.content.length > 0 || (parsed.reasoning?.length ?? 0) > 0;
            const persistenceWarning = providerFailureSettlement?.warning ?? null;
            const providerFailureContent = hasPartialContent
                ? `${parsed.content}\n\n_Response incomplete because the provider stream failed._`
                : 'Sorry, I encountered an error while thinking about that.';
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                error: persistenceWarning ? `${errorMessage}\n\n${persistenceWarning}` : errorMessage,
                content: persistenceWarning
                    ? `${providerFailureContent}\n\n_${persistenceWarning}_`
                    : providerFailureContent,
                reasoning: parsed.reasoning,
            });
            llmStatusStore.set({ state: 'error', message: errorMessage });
        }
    } finally {
        releaseProviderCancellation();
        setActiveAborter(null);
        setChatGenerating(false);
    }
    return undefined;
}
