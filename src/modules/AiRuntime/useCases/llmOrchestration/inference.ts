import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

import { DAW_CHAT_TOOLS } from '../../models/toolDefinitions';
import { WEBLLM_MODEL_ID } from '../../models/ModelInfo';
import { llmStatusStore } from '../../stores/llmStatusStore';
import {
    isLlamaServerRunning,
    generateNativeCompletion,
} from '../../repositories/llamaServerEngine';
import {
    initWebLlmEngine,
    isWebLlmLoaded,
    generateWebLlmToolCalls,
} from '../../repositories/webLlm';
import { generateCloudToolCalls } from '../../repositories/cloudLlm';
import { parseToolCallXml, type ToolCallResult } from '../../transformers/toolCallParser';
import { parseNativeToolCalls } from '../../repositories/nativeToolRegistry';
import { getBackendChain } from './backendResolution';

const logger = Container.getInstance().get(Logger);

/**
 * Send a prompt to the model and get parsed tool calls.
 * Uses a tiered fallback chain: tries each backend in order until one succeeds.
 *
 * Backend dispatch:
 * - cloud:  Claude native tool-use API (no text parsing)
 * - webllm: Hermes-2-Pro native OpenAI tool calling API (no text parsing)
 * - native: llama-server Hermes XML output → parsed via parseToolCallXml + parseNativeToolCalls
 */
export async function generateToolCalls(systemPrompt: string, userMessage: string): Promise<ToolCallResult[]> {
    const chain = getBackendChain();

    if (chain.length === 0) {
        throw new Error('No AI backend available. Configure a cloud API key, or use a WebGPU-capable browser.');
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
                results = await generateWebLlmToolCalls(systemPrompt, userMessage, DAW_CHAT_TOOLS);
            } else {
                if (!isLlamaServerRunning()) {
                    throw new Error('Native AI engine not running');
                }
                const content = await generateNativeCompletion(systemPrompt, userMessage);
                logger.info(
                    `[AI Engine] (native) Raw response (${String(content.length)} chars): ${content.slice(0, 500)}`
                );
                const tsParsed = parseToolCallXml(content);
                const nativeParsed = await parseNativeToolCalls(content);
                results = [...tsParsed, ...nativeParsed];
            }

            logger.info(
                `[AI Engine] (${backend}) ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`
            );

            const modelId = backend === 'native' ? 'native' : backend === 'cloud' ? 'claude' : WEBLLM_MODEL_ID;
            llmStatusStore.set({ state: 'ready', modelId });
            return results;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            logger.warn(`[AI Engine] Backend "${backend}" failed: ${lastError.message}. Trying next...`);
        }
    }

    llmStatusStore.set({ state: 'error', message: lastError?.message ?? 'All backends failed' });
    throw lastError ?? new Error('All AI backends failed');
}
