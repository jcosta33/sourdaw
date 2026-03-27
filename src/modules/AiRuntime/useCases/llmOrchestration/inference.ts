import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';

import { DAW_CHAT_TOOLS, DAW_TOOL_SCHEMAS } from '../../models/toolDefinitions';
import { selectToolsForPrompt } from '../../transformers/toolSelector';
import { WEBLLM_MODEL_ID } from '../../models/ModelInfo';
import { llmStatusStore } from '../../stores/llmStatusStore';
import {
    isLlamaServerRunning,
    generateNativeCompletion,
} from '../../repositories/nativeEngine';
import {
    initWebLlmEngine,
    isWebLlmLoaded,
    generateWebLlmToolCalls,
} from '../../repositories/webLlm';
import { generateCloudToolCalls } from '../../repositories/cloudLlm';
import { parseToolCallXml, type ToolCallResult } from '../../transformers/toolCallParser';
import { getBackendChain } from './backendResolution';

const logger = Container.getInstance().get(Logger);

/**
 * Send a prompt to the model and get parsed tool calls.
 * Uses a tiered fallback chain: tries each backend in order until one succeeds.
 *
 * Backend dispatch:
 * - cloud:  Claude native tool-use API (structured tool calls)
 * - webllm: Hermes-3 native OpenAI tool calling API (structured tool calls)
 * - native: mistral.rs structured tool calling (preferred) or text completion + XML parsing (fallback)
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
                const relevantTools = selectToolsForPrompt(DAW_CHAT_TOOLS, userMessage);
                logger.info(`[AI Engine] (webllm) Using ${String(relevantTools.length)}/${String(DAW_CHAT_TOOLS.length)} tools`);
                results = await generateWebLlmToolCalls(systemPrompt, userMessage, relevantTools);
            } else {
                // Native backend: prefer structured tool calling via mistral.rs
                if (!isLlamaServerRunning()) {
                    throw new Error('Native AI engine not running');
                }
                results = await generateNativeToolCalls(systemPrompt, userMessage);
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

/**
 * Native tool calling via mistral.rs structured API.
 * Falls back to text completion + XML parsing if structured call fails.
 */
async function generateNativeToolCalls(systemPrompt: string, userMessage: string): Promise<ToolCallResult[]> {
    // Try structured tool calling first (Tauri only)
    if (isTauri()) {
        try {
            const tools = DAW_TOOL_SCHEMAS.map((t) => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
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
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
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
