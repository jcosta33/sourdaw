import { isAppError } from '#/infra/errors/isAppError';
import {
    describeAction,
    executeAppAction,
    generateGroupId,
    isAppActionCommittedError,
} from '#/modules/Command/useCases';

import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { type ChatMessage } from '../models/Chat';
import { CHAT_SYSTEM_PROMPT } from '../models/ChatSystemPrompt';
import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import { type RuntimeAction } from '../models/RuntimeAction';
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
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
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

import { createThinkBlockParser } from './createThinkBlockParser';
import { getProjectContext } from './getProjectContext';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { notifyAiChange } from './notifyAiChange';
import { parsePromptToActions } from './parsePromptToActions';

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
            const context = getProjectContext();
            const result = await parsePromptToActions(userText, context, aborter.signal);

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
                    isDsoAction: true,
                });

                const assistantMsgId = `msg-${crypto.randomUUID()}`;
                prompt_assistant_message_id = assistantMsgId;
                appendChatMessage({
                    id: assistantMsgId,
                    role: 'assistant',
                    content: 'Executing...',
                    timestamp: Date.now(),
                    isDsoAction: true,
                });

                if (result.requiresConfirmation) {
                    const confirmationId = `prompt-confirmation-${crypto.randomUUID()}`;
                    const actionLabels = result.actions.map((action) => describeAction(action));
                    proposePendingActionConfirmation({
                        id: confirmationId,
                        prompt: userText,
                        assistantMessageId: assistantMsgId,
                        actions: result.actions,
                        actionLabels,
                    });

                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        pendingActionConfirmationId: confirmationId,
                        pendingActionConfirmationStatus: 'proposed',
                        content: `This prompt requires confirmation before execution:\n\n${result.actions.map((action, index) => `- **${action.type}**: ${actionLabels[index] ?? action.type}`).join('\n')}`,
                    });
                    return;
                }

                const group = generateGroupId(userText);
                const executedLabels: Array<{ action: RuntimeAction; label: string }> = [];
                let action_history_failed_after_commit = false;
                let execution_failure_reason: string | null = null;

                for (const action of result.actions) {
                    try {
                        await executeAppAction(action, { ...group, source: 'prompt' });
                    } catch (error) {
                        if (!isAppActionCommittedError(error)) {
                            execution_failure_reason = error instanceof Error ? error.message : String(error);
                            break;
                        }
                        action_history_failed_after_commit = true;
                    }
                    executedLabels.push({ action, label: describeAction(action) });
                }

                if (executedLabels.length > 0) {
                    const historyGroup: AiActionGroup = {
                        id: group.groupId,
                        prompt: userText,
                        actions: executedLabels.map((entry) => ({
                            kind: 'appAction',
                            actionType: entry.action.type,
                            label: entry.label,
                        })),
                        groupId: group.groupId,
                        timestamp: Date.now(),
                        reverted: false,
                    };
                    pushAiActionGroup(historyGroup);
                    notifyAiChange(
                        `Executed: ${userText}`,
                        executedLabels.map((entry) => entry.action.type)
                    );
                }

                if (execution_failure_reason) {
                    const history_failure_warning = action_history_failed_after_commit
                        ? ' Action history also failed for an earlier applied action.'
                        : '';
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: execution_failure_reason,
                        content:
                            executedLabels.length > 0
                                ? `Partially executed:\n\n${executedLabels.map((entry) => `- **${entry.action.type.replaceAll('_', ' ')}**: ${entry.label}`).join('\n')}\n\nA later action failed: ${execution_failure_reason}.${history_failure_warning} Do not retry the whole command.`
                                : 'Failed to execute prompt command.',
                    });
                    return;
                }

                updateChatMessage(assistantMsgId, {
                    isStreaming: false,
                    content: action_history_failed_after_commit
                        ? `Applied:\n\n${executedLabels.map((length) => `- **${length.action.type.replaceAll('_', ' ')}**: ${length.label}`).join('\n')}\n\nAction history failed after the change was applied. Do not retry this command.`
                        : `Executed:\n\n${executedLabels.map((length) => `- **${length.action.type.replaceAll('_', ' ')}**: ${length.label}`).join('\n')}`,
                });
            } else if (result._jsonEditApplied) {
                // executeDsoEdit already injected the user message and the assistant streaming message.
                // We just need to trigger the toast notification.
                const summary = result._jsonEditSummaries?.join('. ') ?? `Executed: ${userText}`;
                notifyAiChange(summary, []);
            } else if (!result._jsonEditAttempted) {
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                    isDsoAction: true,
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
            const failureContent = configurationChanged
                ? 'Prompt cancelled because the AI configuration changed.'
                : 'Failed to process prompt command.';
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
