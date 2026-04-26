import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { WEBLLM_MODEL_ID } from '../../models/ModelInfo';
import { DAW_TOOL_SCHEMAS } from '../../models/toolDefinitions';
import { generateCloudToolCalls } from '../../repositories/cloudLlm/cloudInference/generateCloudToolCalls';
import { generateNativeCompletion } from '../../repositories/nativeEngine/completions';
import { isNativeEngineReady } from '../../repositories/nativeEngine/lifecycle';
import { initWebLlmEngine, isWebLlmLoaded } from '../../repositories/webLlm/engineLifecycle';
import { generateWebLlmToolCalls } from '../../repositories/webLlm/toolCalling';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { parseToolCallXml, type ToolCallResult } from '../../transformers/toolCallParser';
import { selectToolsForPrompt } from '../../transformers/toolSelector';

import { getBackendChain } from './backendResolution/getBackendChain';

/**
 * Send a prompt to the model and get parsed tool calls.
 * Uses a tiered fallback chain: tries each backend in order until one succeeds.
 *
 * Backend dispatch:
 * - cloud:  Claude native tool-use API (structured tool calls)
 * - webllm: Hermes-3 native OpenAI tool calling API (structured tool calls)
 * - native: mistral.rs structured tool calling (preferred) or text completion + XML parsing (fallback)
 */
export const generateToolCalls = inject({ logger })(({ logger }) => {
    async function generateNativeToolCalls(systemPrompt: string, userMessage: string): Promise<ToolCallResult[]> {
        // Try structured tool calling first (Tauri only)
        if (isTauri()) {
            try {
                const tools = DAW_TOOL_SCHEMAS.map((time) => ({
                    name: time.function.name,
                    description: time.function.description,
                    parameters: time.function.parameters,
                }));

                const results = (await tauriInvoke('native_tool_calling', {
                    systemPrompt,
                    userMessage,
                    tools,
                    temperature: 0.1,
                })) as Array<{ name: string; arguments: Record<string, unknown> }>;

                if (results.length > 0) {
                    logger.info(`[AI Engine] (native/structured) ${String(results.length)} tool call(s)`);
                    return results;
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                logger.warn(`[AI Engine] Structured tool calling failed, falling back to text: ${msg}`);
            }
        }

        // Fallback: text completion + XML/JSON parsing
        const content = await generateNativeCompletion(systemPrompt, userMessage);
        logger.info(
            `[AI Engine] (native/text) Raw response (${String(content.length)} chars): ${content.slice(0, 500)}`
        );
        return parseToolCallXml(content);
    }

    return async function generateToolCalls(systemPrompt: string, userMessage: string): Promise<ToolCallResult[]> {
        const chain = getBackendChain();

        if (chain.length === 0) {
            throw createAiRuntimeError(
                'No AI backend available. Configure a cloud API key, or use a WebGPU-capable browser.'
            );
        }

        llmStatusStore.set({ state: 'generating' });

        let lastError: Error | null = null;

        for (const backend of chain) {
            try {
                let results: ToolCallResult[];

                if (backend === 'cloud') {
                    results = await generateCloudToolCalls(systemPrompt, userMessage);
                } else if (backend === 'webllm') {
                    if (!isWebLlmLoaded()) {
                        await initWebLlmEngine();
                    }
                    const relevantTools = selectToolsForPrompt(DAW_TOOL_SCHEMAS, userMessage);
                    logger.info(
                        `[AI Engine] (webllm) Using ${String(relevantTools.length)}/${String(DAW_TOOL_SCHEMAS.length)} tools`
                    );
                    results = await generateWebLlmToolCalls(systemPrompt, userMessage, relevantTools);
                } else {
                    // Native backend: prefer structured tool calling via mistral.rs
                    if (!isNativeEngineReady()) {
                        throw createAiRuntimeError('Native AI engine not running');
                    }
                    results = await generateNativeToolCalls(systemPrompt, userMessage);
                }

                logger.info(
                    `[AI Engine] (${backend}) ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`
                );

                const modelId = (() => {
                    if (backend === 'native') {
                        return 'native';
                    }
                    if (backend === 'cloud') {
                        return 'claude';
                    }
                    return WEBLLM_MODEL_ID;
                })();
                llmStatusStore.set({ state: 'ready', modelId });
                return results;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn(`[AI Engine] Backend "${backend}" failed: ${lastError.message}. Trying next...`);
            }
        }

        llmStatusStore.set({ state: 'error', message: lastError?.message ?? 'All backends failed' });
        throw lastError ?? new Error('All AI backends failed');
    };
});
