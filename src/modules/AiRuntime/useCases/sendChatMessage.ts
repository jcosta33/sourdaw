import { getLlmEngine } from '../repositories/webLlmRepository';
import { streamNativeCompletion, isLlamaServerRunning } from '../repositories/llamaServerEngine';
import { isCloudAvailable, streamCloudChatCompletion } from '../repositories/cloudLlmRepository';
import { resolveBackend } from './llmOrchestration';
import { chatStore, appendChatMessage, updateChatMessage, setChatGenerating } from '../stores/chatStore';
import { getProjectContext } from './getProjectContext';
import { type ChatMessage } from '../models/Chat';

const CHAT_SYSTEM_PROMPT = `You are a helpful AI assistant built directly into a Digital Audio Workstation (DAW). 
You can help the user with music production concepts, DSP, audio engineering, or explain how to use this software.
The user is currently working on a project. Context about their active workspace, tracks, and clips will be provided.

Keep your answers concise, accurate, and format them nicely in Markdown.
If the user asks you to perform an action on the DAW, explain how they can do it via the command prompt, as your current interface is read-only chat.`;

export async function sendChatMessage(userText: string): Promise<void> {
    const backend = resolveBackend();

    // Verify the appropriate engine is available
    if (backend === 'none') {
        throw new Error('No AI backend available. Configure an API key or use a WebGPU-capable browser.');
    }
    if (backend === 'native' && !isLlamaServerRunning()) {
        throw new Error('Native AI engine is not running. Load the AI engine first.');
    }
    if (backend === 'webllm' && !getLlmEngine()) {
        throw new Error('AI Engine is not initialized or not supported on this device.');
    }
    if (backend === 'cloud' && !isCloudAvailable()) {
        throw new Error('Cloud AI not configured. Set API key in settings.');
    }

    const state = chatStore.value;
    if (!state || state.isGenerating) {
        return;
    }

    setChatGenerating(true);

    const userMsgId = `msg-${crypto.randomUUID()}`;
    const userMessage: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
    };
    appendChatMessage(userMessage);

    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    const initialAssistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
    };
    appendChatMessage(initialAssistantMessage);

    try {
        const workspaceContext = getProjectContext();

        const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\nCURRENT DAW CONTEXT:\n${JSON.stringify(workspaceContext)}`;

        // Keep only the last 24 messages (12 user+assistant pairs) to avoid
        // blowing the context window on long conversations.
        const conversationHistory = chatStore
            .value!.messages.filter((m) => m.id !== assistantMsgId && !m.error)
            .slice(-24)
            .map((m) => ({
                role: m.role,
                content: m.content,
            }));

        const completionMessages = [{ role: 'system' as const, content: systemPrompt }, ...conversationHistory].filter(
            (m) => m.role === 'system' || m.role === 'user' || m.role === 'assistant',
        ) as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

        let fullContent = '';

        if (backend === 'native') {
            // Native: streaming completion via Tauri Channel API
            await streamNativeCompletion(
                completionMessages,
                (token) => {
                    fullContent += token;
                    updateChatMessage(assistantMsgId, { content: fullContent });
                },
                { temperature: 0.7, maxTokens: 2048 },
            );
        } else if (backend === 'cloud') {
            // Cloud: streaming completion via Claude API
            await streamCloudChatCompletion(
                completionMessages,
                (token) => {
                    fullContent += token;
                    updateChatMessage(assistantMsgId, { content: fullContent });
                },
                { temperature: 0.7, maxTokens: 2048 },
            );
        } else {
            // WebLLM: streaming completion via the in-browser engine
            const engine = getLlmEngine()!;
            const asyncChunkGenerator = await engine.chat.completions.create({
                messages: completionMessages,
                temperature: 0.7,
                max_tokens: 2048,
                stream: true,
            });

            for await (const chunk of asyncChunkGenerator) {
                const deltaDesc = chunk.choices[0]?.delta.content;
                if (deltaDesc !== undefined) {
                    fullContent += deltaDesc;
                    updateChatMessage(assistantMsgId, { content: fullContent });
                }
            }
        }

        updateChatMessage(assistantMsgId, { isStreaming: false });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during generation.';
        updateChatMessage(assistantMsgId, {
            isStreaming: false,
            error: errorMessage,
            content: 'Sorry, I encountered an error while thinking about that.',
        });
    } finally {
        setChatGenerating(false);
    }
}
