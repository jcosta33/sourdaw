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
import { proposePendingActionConfirmation } from '../stores/pendingActionConfirmationStore';

import { getProjectContext } from './getProjectContext';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { notifyAiChange } from './notifyAiChange';
import { parsePromptToActions } from './parsePromptToActions';

export type ThinkBlockResult = { reasoning: string | undefined; content: string };

/** Strip or extract a `<think>…</think>` block from LLM output, including incomplete streaming blocks. */
export function extractThinkBlock(raw: string): ThinkBlockResult {
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

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/**
 * Incremental `<think>…</think>` parser for the streaming chat loop.
 *
 * The previous code called {@link extractThinkBlock} on the *entire* accumulated
 * buffer for every token, making the stream O(N·L) (quadratic in the final
 * length). This parser tracks the think-block boundary across tokens and only
 * inspects the appended slice, so the whole stream is linear.
 *
 * It is intentionally output-compatible with {@link extractThinkBlock}: feeding
 * a sequence of tokens to {@link push} yields, at every step, the same
 * `{ reasoning, content }` that `extractThinkBlock(fullBuffer)` would return.
 */
export function createThinkBlockParser(): {
    push(token: string): ThinkBlockResult;
    snapshot(): ThinkBlockResult;
} {
    // Phases of the anchored scan:
    //   'pending'  — still deciding whether the buffer opens with `<think>`
    //                (a prefix of leading whitespace + `<think>` seen so far).
    //   'thinking' — inside an open, not-yet-closed think block.
    //   'closed'   — the think block closed; everything after is content.
    //   'plain'    — the buffer does not start with a think block; raw is content.
    let phase: 'pending' | 'thinking' | 'plain' | 'closed' = 'pending';

    // The expected anchored opener: optional leading whitespace then `<think>`.
    // We only need to remember the leading whitespace we have consumed so far.
    let leadingWhitespace = '';
    // Reasoning text accumulated while in the 'thinking' phase (raw, untrimmed).
    let reasoning = '';
    // Offset from which the next `</think>` scan starts. Everything before it has
    // already been searched, so a growing reasoning block is scanned only once
    // overall (kept back by CLOSE_TAG length so a tag split across tokens is seen).
    let closeScanFrom = 0;
    // Content accumulated after a fully-formed block (raw, untrimmed).
    let content = '';
    // For the 'plain' / 'pending' phases we keep the whole buffer so the
    // one-shot regex fallback stays exact for unusual inputs.
    let buffer = '';

    function result(): ThinkBlockResult {
        switch (phase) {
            case 'thinking':
                return { reasoning: reasoning.trim() || undefined, content: '' };
            case 'closed':
                return { reasoning: reasoning.trim() || undefined, content: content.trim() };
            case 'plain':
            case 'pending':
            default:
                // 'plain': the buffer does not open with a think block.
                // 'pending': still deciding (leading whitespace or a partial
                // opener like `<th`). In both cases the one-shot parser would
                // not yet have matched an opener, so the raw buffer is content.
                return { reasoning: undefined, content: buffer };
        }
    }

    /** Resolve the 'pending' phase as more of the buffer becomes available. */
    function resolvePending(): void {
        const trimmedStart = buffer.replace(/^\s*/, '');
        leadingWhitespace = buffer.slice(0, buffer.length - trimmedStart.length);

        if (trimmedStart.length === 0) {
            // Only whitespace so far — stay pending.
            return;
        }

        if (trimmedStart.startsWith(OPEN_TAG)) {
            // Opener complete — switch to thinking and reduce to the inner text.
            phase = 'thinking';
            reasoning = trimmedStart.slice(OPEN_TAG.length);
            scanForClose();
            return;
        }

        if (OPEN_TAG.startsWith(trimmedStart)) {
            // A strict prefix of `<think>` (e.g. `<th`) — still possibly an opener.
            return;
        }

        // The non-whitespace start is not `<think>` and cannot become it.
        phase = 'plain';
    }

    /** While 'thinking', detect a `</think>` that may straddle token boundaries. */
    function scanForClose(): void {
        const closeIdx = reasoning.indexOf(CLOSE_TAG, closeScanFrom);
        if (closeIdx === -1) {
            // Not found yet. Advance the scan window but keep CLOSE_TAG-1 chars of
            // overlap so a tag split across the next token boundary is still seen.
            closeScanFrom = Math.max(0, reasoning.length - (CLOSE_TAG.length - 1));
            return;
        }
        const after = reasoning.slice(closeIdx + CLOSE_TAG.length);
        reasoning = reasoning.slice(0, closeIdx);
        content = after.replace(/^\s*/, '');
        phase = 'closed';
        void leadingWhitespace;
    }

    return {
        push(token: string): ThinkBlockResult {
            switch (phase) {
                case 'plain':
                    buffer += token;
                    break;
                case 'closed':
                    content += token;
                    break;
                case 'thinking':
                    reasoning += token;
                    scanForClose();
                    break;
                case 'pending':
                    buffer += token;
                    resolvePending();
                    break;
            }
            return result();
        },
        snapshot(): ThinkBlockResult {
            return result();
        },
    };
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
    // Incremental think-block parser: feeding each streamed token keeps the
    // boundary scan linear instead of re-scanning the whole buffer per token.
    // It also retains the full accumulated text internally, so no separate
    // buffer is needed.
    const thinkParser = createThinkBlockParser();

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
            await streamCloudChatCompletion(
                completionMessages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    const parsed = thinkParser.push(token);
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
            })) as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>;

            for await (const chunk of asyncChunkGenerator) {
                if (aborter.signal.aborted) {
                    break;
                }
                const deltaDesc = chunk.choices[0]?.delta.content;
                if (deltaDesc !== undefined) {
                    const parsed = thinkParser.push(deltaDesc);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                }
            }
        }

        // Strip <think>…</think> reasoning block before storing the final message.
        const { reasoning, content: cleanContent } = thinkParser.snapshot();
        updateChatMessage(assistantMsgId, { isStreaming: false, content: cleanContent, reasoning });
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
        if (errorMessage === 'AbortedByUser' || errorMessage.includes('AbortError')) {
            // Clean abort, leave generated partial content intact and strip parsing blocks
            const parsed = thinkParser.snapshot();
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
