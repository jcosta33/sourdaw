import { isAppError } from '#/infra/errors/isAppError';
import { generateGroupId } from '#/modules/Command/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { type ChatMessage } from '../models/Chat';
import { CHAT_SYSTEM_PROMPT } from '../models/ChatSystemPrompt';
import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import {
    type CloudChatCompletionOutcome,
    streamCloudChatCompletion,
} from '../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { getCloudProviderInfo } from '../repositories/cloudLlm/getCloudProviderInfo';
import { isCloudAvailable } from '../repositories/cloudLlm/isCloudAvailable';
import { isNativeEngineReady } from '../repositories/nativeEngine/isNativeEngineReady';
import { streamNativeCompletion } from '../repositories/nativeEngine/streaming';
import { getActiveModelId } from '../repositories/webLlm/getActiveModelId';
import { getLlmEngine } from '../repositories/webLlm/getLlmEngine';
import { aiBackendPreferenceStore } from '../stores/aiBackendPreferenceStore';
import {
    chatStore,
    appendChatMessage,
    updateChatMessage,
    setChatGenerating,
    setActiveAborter,
} from '../stores/chatStore';
import { llmStatusStore } from '../stores/llmStatusStore';
import { proposePendingActionConfirmation } from '../stores/pendingActionConfirmationStore';

import { createStemImportConfirmationResourceLease } from './agentReference/createStemImportConfirmationResourceLease';
import { compilePlannedActionCommandBatch } from './compilePlannedActionCommandBatch';
import { createThinkBlockParser } from './createThinkBlockParser';
import { describePendingActionConfirmation } from './describePendingActionConfirmation';
import { executePlannedActions } from './executePlannedActions';
import { getProjectContext } from './getProjectContext';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { planPromptActions } from './planPromptActions';

function getBackendModelId(backend: RunnableAiBackend): string {
    if (backend === 'native') {
        return 'native';
    }
    if (backend === 'cloud') {
        return getCloudProviderInfo()?.model ?? 'cloud';
    }
    return getActiveModelId();
}

export async function sendChatMessage(userText: string): Promise<void> {
    const backend = resolveBackend();
    const state = chatStore.value;
    if (!state || state.isGenerating) {
        return;
    }

    // Regular chat streams from one selected backend. Prompt mode delegates
    // readiness and provider fallback to generateToolCalls.
    if (backend === 'none') {
        throw createAiRuntimeError('No AI backend available. Configure an API key or use a WebGPU-capable browser.');
    }
    if (state.chatMode !== 'prompt' && backend === 'native' && !isNativeEngineReady()) {
        throw createAiRuntimeError('Native AI engine is not running. Load the AI engine first.');
    }
    if (state.chatMode !== 'prompt' && backend === 'webllm' && !getLlmEngine()) {
        throw createAiRuntimeError('AI Engine is not initialized or not supported on this device.');
    }
    if (state.chatMode !== 'prompt' && backend === 'cloud' && !isCloudAvailable()) {
        throw createAiRuntimeError('Cloud AI not configured. Set API key in settings.');
    }

    setChatGenerating(true);

    // ── Prompt Command Mode ──────────────────────────────────────────────
    if (state.chatMode === 'prompt') {
        const aborter = new AbortController();
        let prompt_assistant_message_id: string | null = null;
        setActiveAborter(aborter);

        try {
            const { context, result, projectRevision } = await planPromptActions({
                prompt: userText,
                signal: aborter.signal,
            });

            if (aborter.signal.aborted) {
                return;
            }

            if (result.actions.length > 0) {
                // Manually inject messages for Fast-Path execution
                const userMsgId = `msg-${crypto.randomUUID()}`;
                appendChatMessage({
                    id: userMsgId,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                    isCommandAction: true,
                });

                const assistantMsgId = `msg-${crypto.randomUUID()}`;
                prompt_assistant_message_id = assistantMsgId;
                appendChatMessage({
                    id: assistantMsgId,
                    role: 'assistant',
                    content: 'Executing...',
                    timestamp: Date.now(),
                    isCommandAction: true,
                });

                const confirmationDescription = describePendingActionConfirmation({
                    actions: result.actions,
                    context,
                    prompt: userText,
                    wholeProjectVibeMixPlan: result.wholeProjectVibeMixPlan,
                    workflowCapabilityId: result.workflowCapabilityId,
                });
                const commandGroup = generateGroupId(userText);
                const { commandEnvelopes, commandBatch } = compilePlannedActionCommandBatch({
                    actions: result.actions,
                    actionLabels: confirmationDescription.actionLabels,
                    autoCommit: !result.requiresConfirmation,
                    context,
                    group: commandGroup,
                    intent: userText,
                    projectRevision,
                    runId: assistantMsgId,
                    protectedTargetIds: confirmationDescription.protectedUnchanged.map((item) => item.id),
                });

                if (result.requiresConfirmation) {
                    const confirmationId = `prompt-confirmation-${crypto.randomUUID()}`;
                    const confirmation = proposePendingActionConfirmation({
                        id: confirmationId,
                        prompt: userText,
                        assistantMessageId: assistantMsgId,
                        actions: result.actions,
                        actionLabels: confirmationDescription.actionLabels,
                        commandEnvelopes,
                        commandBatch,
                        affectedIds: confirmationDescription.affectedIds,
                        protectedUnchanged: confirmationDescription.protectedUnchanged,
                        risk: confirmationDescription.risk,
                        executionMode: result.executionMode,
                        groupId: commandGroup.groupId,
                        groupLabel: commandGroup.groupLabel,
                        projectRevision,
                        resourceLease: createStemImportConfirmationResourceLease(result.actions),
                    });
                    if (!confirmation) {
                        updateChatMessage(assistantMsgId, {
                            isStreaming: false,
                            pendingActionConfirmationStatus: 'failed',
                            error: 'Prepared action resources exceed the live confirmation limit.',
                            content:
                                'This proposal was not retained because pending prepared resources reached their safe limit. Resolve or cancel an earlier proposal, then try again.',
                        });
                        return;
                    }

                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        pendingActionConfirmationId: confirmationId,
                        pendingActionConfirmationStatus: 'proposed',
                        content: confirmationDescription.content,
                    });
                    return;
                }

                const executionInput = {
                    prompt: userText,
                    actions: result.actions,
                    group: commandGroup,
                    projectRevision,
                    executionMode: result.executionMode,
                    signal: aborter.signal,
                };
                const execution = commandBatch
                    ? await executePlannedActions({ ...executionInput, commandBatch })
                    : await executePlannedActions({ ...executionInput, legacyExecution: true });

                if (execution.status === 'committed') {
                    const receiptWarnings: string[] = [];
                    if (execution.commitWarning) {
                        receiptWarnings.push(`Post-commit project follow-up warning: ${execution.commitWarning}`);
                    }
                    if (execution.reportingWarning) {
                        receiptWarnings.push(
                            `AI history or notification reporting warning: ${execution.reportingWarning}`
                        );
                    }
                    const actionSummary = execution.actions
                        .map((entry) => `- **${entry.actionType.replaceAll('_', ' ')}**: ${entry.label}`)
                        .join('\n');
                    const warningSummary = receiptWarnings.join(' ');
                    const content = warningSummary
                        ? `Applied:\n\n${actionSummary}\n\n${warningSummary} The project change committed. Do not retry automatically; inspect the current project state.`
                        : `Executed:\n\n${actionSummary}`;
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: warningSummary || undefined,
                        content,
                    });
                    return;
                }

                if (execution.status === 'executed') {
                    const receiptWarnings: string[] = [];
                    if (execution.executionWarning) {
                        receiptWarnings.push(`Runtime follow-up warning: ${execution.executionWarning}`);
                    }
                    if (execution.reportingWarning) {
                        receiptWarnings.push(
                            `AI history or notification reporting warning: ${execution.reportingWarning}`
                        );
                    }
                    const actionSummary = execution.actions
                        .map((entry) => `- **${entry.actionType.replaceAll('_', ' ')}**: ${entry.label}`)
                        .join('\n');
                    const warningSummary = receiptWarnings.join(' ');
                    let content = `Executed:\n\n${actionSummary}`;
                    if (warningSummary) {
                        content = `${content}\n\n${warningSummary} The runtime command executed. Do not retry automatically; inspect the current runtime state.`;
                    }
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: warningSummary || undefined,
                        content,
                    });
                    return;
                }

                if (execution.status === 'invalidated') {
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: execution.reason,
                        content:
                            'The project changed before this command could commit. Review it and submit the command again.',
                    });
                    return;
                }

                if (execution.status === 'cancelled') {
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: 'Command cancelled before it committed. No project changes were applied.',
                    });
                    return;
                }

                if (execution.status === 'no-op') {
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: 'No project changes were needed.',
                    });
                    return;
                }

                if (execution.status === 'ambiguous') {
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: execution.reason,
                        content: `The command stopped after an uncertain partial commit: ${execution.reason}. Do not retry it; inspect the project first.`,
                    });
                    return;
                }

                updateChatMessage(assistantMsgId, {
                    isStreaming: false,
                    error: execution.reason,
                    content: `Failed to execute prompt command atomically: ${execution.reason}`,
                });
            } else if (result.rejectionReason) {
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: `Command not executed: ${result.rejectionReason}`,
                    timestamp: Date.now(),
                    error: result.rejectionReason,
                });
            } else {
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                    isCommandAction: true,
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: 'No actions were matched or executed for your command.',
                    timestamp: Date.now(),
                    error: 'No actions matched',
                });
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const configurationChanged = isAiRuntimeConfigurationChangedError(error);
            const proposalInvalidated = error instanceof AiProposalInvalidatedError;
            let failureContent = 'Failed to process prompt command.';
            if (configurationChanged) {
                failureContent = 'Prompt cancelled because the AI configuration changed.';
            } else if (proposalInvalidated) {
                failureContent =
                    'The project changed while this command was being planned. Review the current project and submit it again.';
            }
            if (prompt_assistant_message_id) {
                updateChatMessage(prompt_assistant_message_id, {
                    isStreaming: false,
                    content: configurationChanged
                        ? 'Prompt cancelled because the AI configuration changed.'
                        : 'Failed to execute prompt command.',
                    error: reason,
                });
            } else {
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: failureContent,
                    error: reason,
                    timestamp: Date.now(),
                });
            }
        } finally {
            setActiveAborter(null);
            setChatGenerating(false);
        }
        return;
    }

    // ── Regular Chat Mode ───────────────────────────────────────────────
    const userMsgId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: userMsgId,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
    });

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
    const previousLlmStatus = llmStatusStore.value;
    llmStatusStore.set({ state: 'generating' });
    // Incremental think-block parser: feeding each streamed token keeps the
    // boundary scan linear instead of re-scanning the whole buffer per token.
    // It also retains the full accumulated text internally, so no separate
    // buffer is needed.
    const thinkParser = createThinkBlockParser();
    let cloudOutcome: CloudChatCompletionOutcome | null = null;
    let webLlmIncompleteReason: string | null = null;

    try {
        const workspaceContext = getProjectContext();

        const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\nCURRENT DAW CONTEXT:\n${JSON.stringify(workspaceContext)}`;

        // Keep only the last 24 messages (12 user+assistant pairs) to avoid
        // blowing the context window on long conversations.
        const conversationHistory = chatStore
            .value!.messages.filter((message) => message.id !== assistantMsgId && !message.error)
            .slice(-24)
            .map((message) => ({
                role: message.role,
                content: message.content,
            }));

        const completionMessages: Array<{
            role: 'system' | 'user' | 'assistant';
            content: string;
        }> = [{ role: 'system', content: systemPrompt }, ...conversationHistory];

        if (backend === 'native') {
            // Native: streaming completion via Tauri Channel API
            await streamNativeCompletion(
                completionMessages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    const parsed = thinkParser.push(token);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                },
                // Thread the abort signal so Stop tears the stream down at the
                // source: in browser dev mode the SSE loop breaks immediately
                // instead of draining the whole response, and in native mode the
                // watchdog race is unblocked. Without this, only the per-token
                // throw above could stop it — and only while tokens keep arriving.
                { temperature: 0.7, maxTokens: 2048, signal: aborter.signal }
            );
        } else if (backend === 'cloud') {
            // Cloud: streaming completion via Claude API
            cloudOutcome = await streamCloudChatCompletion(
                completionMessages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    const parsed = thinkParser.push(token);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                },
                { temperature: 0.7, maxTokens: 2048, signal: aborter.signal }
            );
        } else {
            // WebLLM: streaming completion via the in-browser engine.
            // Yield to the render loop before starting inference — the first
            // forward pass triggers WebGPU shader compilation which locks the
            // GPU (shared with the compositor). Without this yield, the browser
            // can't paint the "Thinking..." state before the GPU gets busy.
            await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
            aborter.signal.throwIfAborted();

            const engine = getLlmEngine()!;
            function interruptWebLlm(): void {
                engine.interruptGenerate();
            }
            aborter.signal.addEventListener('abort', interruptWebLlm, { once: true });

            try {
                const asyncChunkGenerator = (await engine.chat.completions.create({
                    messages: completionMessages,
                    temperature: 0.7,
                    max_tokens: 2048,
                    stream: true,
                })) as AsyncIterable<{
                    choices: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
                }>;
                let sawTerminalReason = false;

                for await (const chunk of asyncChunkGenerator) {
                    if (aborter.signal.aborted) {
                        break;
                    }
                    const choice = chunk.choices[0];
                    const deltaDesc = choice?.delta.content;
                    if (deltaDesc !== undefined) {
                        const parsed = thinkParser.push(deltaDesc);
                        updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                    }
                    if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
                        sawTerminalReason = true;
                        if (choice.finish_reason !== 'stop') {
                            webLlmIncompleteReason = choice.finish_reason;
                        }
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

        // Strip <think>…</think> reasoning block before storing the final message.
        const { reasoning, content: cleanContent } = thinkParser.snapshot();
        const incompleteReason = cloudOutcome?.status === 'incomplete' ? cloudOutcome.reason : webLlmIncompleteReason;
        const incompleteNotice =
            incompleteReason === null ? '' : `\n\n_Response incomplete: provider stopped at ${incompleteReason}._`;
        let incompleteError: string | undefined;
        if (cloudOutcome?.status === 'incomplete') {
            incompleteError = `Hosted AI response incomplete (${cloudOutcome.reason})`;
        } else if (webLlmIncompleteReason !== null) {
            incompleteError = `WebLLM response incomplete (${webLlmIncompleteReason})`;
        }
        updateChatMessage(assistantMsgId, {
            isStreaming: false,
            content: `${cleanContent}${incompleteNotice}`,
            reasoning,
            error: incompleteError,
        });
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
        if (isAiRuntimeConfigurationChangedError(error)) {
            const parsed = thinkParser.snapshot();
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: parsed.content,
                reasoning: parsed.reasoning,
                error: 'Hosted AI configuration changed; this response was cancelled.',
            });
            llmStatusStore.set({ state: 'idle' });
            return;
        }

        const wasAborted =
            aborter.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError') ||
            errorMessage === 'AbortedByUser' ||
            errorMessage.includes('AbortError');
        if (wasAborted) {
            // Clean abort, leave generated partial content intact and strip parsing blocks
            const parsed = thinkParser.snapshot();
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
            const parsed = thinkParser.snapshot();
            const hasPartialContent = parsed.content.length > 0 || (parsed.reasoning?.length ?? 0) > 0;
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                error: errorMessage,
                content: hasPartialContent
                    ? `${parsed.content}\n\n_Response incomplete because the provider stream failed._`
                    : 'Sorry, I encountered an error while thinking about that.',
                reasoning: parsed.reasoning,
            });
            llmStatusStore.set({ state: 'error', message: errorMessage });
        }
    } finally {
        setActiveAborter(null);
        setChatGenerating(false);
    }
}
