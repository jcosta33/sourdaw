import { isAppError } from '#/infra/errors/isAppError';
import { describeAction, executeAppAction, generateGroupId } from '#/modules/Command/useCases';

import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { type ChatMessage } from '../models/Chat';
import { CHAT_SYSTEM_PROMPT } from '../models/chatSystemPrompt';
import { type RuntimeAction } from '../models/RuntimeAction';
import { streamCloudChatCompletion } from '../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { isCloudAvailable } from '../repositories/cloudLlm/keyManagement';
import { isNativeEngineReady } from '../repositories/nativeEngine/lifecycle';
import { streamNativeCompletion } from '../repositories/nativeEngine/streaming';
import { getLlmEngine } from '../repositories/webLlm/engineLifecycle';
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
import {
    chatStore,
    appendChatMessage,
    updateChatMessage,
    setChatGenerating,
    setActiveAborter,
} from '../stores/chatStore';

import { getProjectContext } from './getProjectContext';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { notifyAiChange } from './notifyAiChange';
import { parsePromptToActions } from './parsePromptToActions';

/** Strip or extract a `<think>…</think>` block from LLM output, including incomplete streaming blocks. */
function extractThinkBlock(raw: string): { reasoning: string | undefined; content: string } {
    // 1. Fully formed block
    const match = raw.match(/^\s*<think>([\s\S]*?)<\/think>\s*/);
    if (match) {
        return {
            reasoning: match[1]?.trim() || undefined,
            content: raw.slice(match[0].length).trim(),
        };
    }

    // 2. Partial (streaming) block without closing tag
    const partialMatch = raw.match(/^\s*<think>([\s\S]*)$/);
    if (partialMatch) {
        return {
            reasoning: partialMatch[1]?.trim() || undefined,
            content: '', // Still thinking! No actual final content yet
        };
    }

    // 3. No think block at all
    return { reasoning: undefined, content: raw };
}

export async function sendChatMessage(userText: string): Promise<void> {
    const backend = resolveBackend();

    // Verify the appropriate engine is available
    if (backend === 'none') {
        throw createAiRuntimeError('No AI backend available. Configure an API key or use a WebGPU-capable browser.');
    }
    if (backend === 'native' && !isNativeEngineReady()) {
        throw createAiRuntimeError('Native AI engine is not running. Load the AI engine first.');
    }
    if (backend === 'webllm' && !getLlmEngine()) {
        throw createAiRuntimeError('AI Engine is not initialized or not supported on this device.');
    }
    if (backend === 'cloud' && !isCloudAvailable()) {
        throw createAiRuntimeError('Cloud AI not configured. Set API key in settings.');
    }

    const state = chatStore.value;
    if (!state || state.isGenerating) {
        return;
    }

    setChatGenerating(true);

    // ── Prompt Command Mode ──────────────────────────────────────────────
    if (state.chatMode === 'prompt') {
        const aborter = new AbortController();
        setActiveAborter(aborter);

        try {
            const context = getProjectContext();
            const result = await parsePromptToActions(userText, context, aborter.signal);

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
                appendChatMessage({
                    id: assistantMsgId,
                    role: 'assistant',
                    content: 'Executing...',
                    timestamp: Date.now(),
                    isDsoAction: true,
                });
                const group = generateGroupId(userText);
                const executedLabels: Array<{ action: RuntimeAction; label: string }> = [];

                for (const action of result.actions) {
                    await executeAppAction(action, { ...group, source: 'prompt' });
                    executedLabels.push({ action, label: describeAction(action) });
                }

                const historyGroup: AiActionGroup = {
                    id: group.groupId,
                    prompt: userText,
                    actions: executedLabels.map((length) => ({
                        kind: 'appAction',
                        actionType: length.action.type,
                        label: length.label,
                    })),
                    groupId: group.groupId,
                    timestamp: Date.now(),
                    reverted: false,
                };
                pushAiActionGroup(historyGroup);

                notifyAiChange(
                    `Executed: ${userText}`,
                    result.actions.map((alpha) => alpha.type)
                );

                updateChatMessage(assistantMsgId, {
                    isStreaming: false,
                    content: `Executed:\n\n${executedLabels.map((length) => `- **${length.action.type.replaceAll('_', ' ')}**: ${length.label}`).join('\n')}`,
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
            appendChatMessage({
                id: `msg-${crypto.randomUUID()}`,
                role: 'user',
                content: userText,
                timestamp: Date.now(),
            });
            appendChatMessage({
                id: `msg-${crypto.randomUUID()}`,
                role: 'assistant',
                content: 'Failed to process prompt command.',
                error: String(error),
                timestamp: Date.now(),
            });
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
    let fullContent = '';

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

        const completionMessages = [{ role: 'system' as const, content: systemPrompt }, ...conversationHistory].filter(
            (message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant'
        ) as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

        if (backend === 'native') {
            // Native: streaming completion via Tauri Channel API
            await streamNativeCompletion(
                completionMessages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    fullContent += token;
                    const parsed = extractThinkBlock(fullContent);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                },
                { temperature: 0.7, maxTokens: 2048 }
            );
        } else if (backend === 'cloud') {
            // Cloud: streaming completion via Claude API
            await streamCloudChatCompletion(
                completionMessages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    fullContent += token;
                    const parsed = extractThinkBlock(fullContent);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                },
                { temperature: 0.7, maxTokens: 2048 }
            );
        } else {
            // WebLLM: streaming completion via the in-browser engine.
            // Yield to the render loop before starting inference — the first
            // forward pass triggers WebGPU shader compilation which locks the
            // GPU (shared with the compositor). Without this yield, the browser
            // can't paint the "Thinking..." state before the GPU gets busy.
            await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

            const engine = getLlmEngine()!;
            const asyncChunkGenerator = (await engine.chat.completions.create({
                messages: completionMessages,
                temperature: 0.7,
                max_tokens: 2048,
                stream: true,
            })) as AsyncIterable<any>;

            for await (const chunk of asyncChunkGenerator) {
                if (aborter.signal.aborted) {
                    break;
                }
                const deltaDesc = chunk.choices[0]?.delta.content;
                if (deltaDesc !== undefined) {
                    fullContent += deltaDesc;
                    const parsed = extractThinkBlock(fullContent);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                }
            }
        }

        // Strip <think>…</think> reasoning block before storing the final message.
        const { reasoning, content: cleanContent } = extractThinkBlock(fullContent);
        updateChatMessage(assistantMsgId, { isStreaming: false, content: cleanContent, reasoning });
    } catch (error) {
        const errorMessage = isAppError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : 'An unknown error occurred during generation.';
        if (errorMessage === 'AbortedByUser' || errorMessage.includes('AbortError')) {
            // Clean abort, leave generated partial content intact and strip parsing blocks
            const parsed = extractThinkBlock(fullContent);
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: parsed.content,
                reasoning: parsed.reasoning,
            });
        } else {
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                error: errorMessage,
                content: 'Sorry, I encountered an error while thinking about that.',
            });
        }
    } finally {
        setActiveAborter(null);
        setChatGenerating(false);
    }
}
