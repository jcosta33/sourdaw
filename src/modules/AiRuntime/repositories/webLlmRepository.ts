/**
 * Repository: WebLLM (browser WebGPU) engine.
 *
 * Model: Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC
 * Uses the native OpenAI-compatible tool calling API (tools + tool_choice)
 * instead of JSON mode + prompt engineering. Hermes-2-Pro natively supports
 * one-round function calling via this interface.
 *
 * Architecture: Web Worker (CreateWebWorkerMLCEngine) to keep inference
 * off the main thread. The last streamed chunk carries the tool_calls.
 */

import {
    type ChatCompletionMessageParam,
    type ChatCompletionTool,
    type ChatCompletionChunk,
    CreateWebWorkerMLCEngine,
} from '@mlc-ai/web-llm';

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

import { WEBLLM_MODEL_ID } from '../models/ModelInfo';
import { llmStatusStore } from '../stores/llmStatusStore';
import { type ToolCallResult } from '../transformers/toolCallParser';
import LlmWorker from './llmWorker?worker';

const logger = Container.getInstance().get(Logger);

type WebLlmEngine = Awaited<ReturnType<typeof CreateWebWorkerMLCEngine>>;

let engine: WebLlmEngine | null = null;
let initPromise: Promise<WebLlmEngine> | null = null;
let engineWorker: Worker | null = null;

export function initWebLlmEngine(): Promise<WebLlmEngine> {
    if (engine) {
        return Promise.resolve(engine);
    }
    if (initPromise) {
        return initPromise;
    }

    // WebGPU is required — absent on Linux (WebKitGTK) and older browsers
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        return Promise.reject(
            new Error('WebGPU not available — WebLLM requires WebGPU. Use native or cloud backend instead.')
        );
    }

    initPromise = (async () => {
        llmStatusStore.set({ state: 'loading', progress: 0, text: 'Loading AI engine...' });

        const worker = new LlmWorker();
        engineWorker = worker;
        const created = await CreateWebWorkerMLCEngine(
            worker,
            WEBLLM_MODEL_ID,
            {
                initProgressCallback: (report) => {
                    llmStatusStore.set({
                        state: 'loading',
                        progress: report.progress,
                        text: report.text,
                    });
                },
            },
            { context_window_size: 4096 }
        );

        engine = created;
        llmStatusStore.set({ state: 'ready', modelId: WEBLLM_MODEL_ID });
        return created;
    })();

    return initPromise;
}

export function unloadWebLlmEngine(): void {
    if (engineWorker) {
        engineWorker.terminate();
        engineWorker = null;
    }
    engine = null;
    initPromise = null;
    logger.info('[AI Engine] WebLLM unloaded from memory');
}

export function isWebLlmLoaded(): boolean {
    return engine !== null;
}

/**
 * Generate tool calls using Hermes-2-Pro's native tool calling API.
 *
 * Uses streaming (stream: true) so the UI shows progress; the last non-usage
 * chunk contains the tool_calls array when tool_choice="auto" triggers tools.
 * Falls back to zero results if the model produces no tool calls.
 */
export async function generateWebLlmToolCalls(
    systemPrompt: string,
    userMessage: string,
    tools: ChatCompletionTool[]
): Promise<ToolCallResult[]> {
    const eng = await initWebLlmEngine();

    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];

    // Stream the response — the last chunk before the usage chunk holds tool_calls
    const asyncChunkGenerator = await eng.chat.completions.create({
        messages,
        tools,
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.1,
        seed: 0,
    });

    let lastContentChunk: ChatCompletionChunk | undefined;

    for await (const chunk of asyncChunkGenerator) {
        // Usage chunk is always last and has no choices content
        if (!chunk.usage) {
            lastContentChunk = chunk;
        }
    }

    const toolCallsRaw = lastContentChunk?.choices[0]?.delta?.tool_calls;

    if (!toolCallsRaw || toolCallsRaw.length === 0) {
        logger.warn('[WebLLM] No tool calls returned by model — model may have produced text instead.');
        return [];
    }

    // Map WebLLM tool_calls → ToolCallResult[]
    const results: ToolCallResult[] = [];
    for (const tc of toolCallsRaw) {
        if (tc.function?.name) {
            let args: Record<string, unknown> = {};
            try {
                args = JSON.parse(tc.function.arguments ?? '{}') as Record<string, unknown>;
            } catch {
                logger.warn(
                    `[WebLLM] Failed to parse tool call args for "${tc.function.name}": ${tc.function.arguments}`
                );
            }
            results.push({ name: tc.function.name, arguments: args });
        }
    }

    logger.info(`[WebLLM] ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`);
    return results;
}

/**
 * Legacy text completion — kept for the chat assistant (non-command use).
 * The command engine now uses generateWebLlmToolCalls instead.
 */
export async function generateWebLlmCompletion(systemPrompt: string, userMessage: string): Promise<string> {
    const eng = await initWebLlmEngine();
    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];
    const response = await eng.chat.completions.create({
        messages,
        temperature: 0.3,
        max_tokens: 1024,
        seed: 0,
    });
    return response.choices[0]?.message.content ?? '';
}

export function getLlmEngine(): WebLlmEngine | null {
    return engine;
}
