import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { isAiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { WEBLLM_MODEL_ID } from '../../models/ModelInfo';
import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../../models/ToolDefinitions';
import { generateCloudToolCalls } from '../../repositories/cloudLlm/cloudInference/generateCloudToolCalls';
import { getCloudProviderInfo } from '../../repositories/cloudLlm/getCloudProviderInfo';
import { generateNativeCompletion } from '../../repositories/nativeEngine/completions';
import { isNativeEngineReady } from '../../repositories/nativeEngine/isNativeEngineReady';
import { generateNativeToolCalls as generateNativeStructuredToolCalls } from '../../repositories/nativeEngine/nativeToolCalling';
import { initWebLlmEngine } from '../../repositories/webLlm/initWebLlmEngine';
import { isWebLlmLoaded } from '../../repositories/webLlm/isWebLlmLoaded';
import { generateWebLlmToolCalls } from '../../repositories/webLlm/toolCalling';
import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { parseToolCallXml, type ToolCallResult } from '../../transformers/toolCallParser';
import { selectToolsForPrompt } from '../../transformers/toolSelector';

import { getBackendChain } from './backendResolution/getBackendChain';

function createToolPlanningAbortError(): Error {
    const error = new Error('AI tool planning aborted');
    error.name = 'AbortError';
    return error;
}

async function waitForInference<TResult>(inference: Promise<TResult>, signal?: AbortSignal): Promise<TResult> {
    if (!signal) {
        return inference;
    }
    if (signal.aborted) {
        throw createToolPlanningAbortError();
    }
    const activeSignal = signal;

    return new Promise<TResult>((resolve, reject) => {
        function onAbort(): void {
            reject(createToolPlanningAbortError());
        }

        async function settleInference(): Promise<void> {
            try {
                const result = await inference;
                activeSignal.removeEventListener('abort', onAbort);
                resolve(result);
            } catch (error) {
                activeSignal.removeEventListener('abort', onAbort);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        }

        activeSignal.addEventListener('abort', onAbort, { once: true });
        void settleInference();
    });
}

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
    async function generateNativeToolCalls(
        systemPrompt: string,
        userMessage: string,
        toolSchemas: readonly ToolSchema[],
        signal?: AbortSignal
    ): Promise<ToolCallResult[]> {
        try {
            const tools = toolSchemas.map((tool) => ({
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters,
            }));

            const results = await waitForInference(
                generateNativeStructuredToolCalls({
                    systemPrompt,
                    userMessage,
                    tools,
                    temperature: 0.1,
                    signal,
                }),
                signal
            );

            if (results !== null) {
                logger.info(`[AI Engine] (native/structured) ${String(results.length)} tool call(s)`);
                return results;
            }
        } catch (error) {
            if (signal?.aborted) {
                throw createToolPlanningAbortError();
            }
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn(`[AI Engine] Structured tool calling failed, falling back to text: ${msg}`);
        }

        // Fallback: text completion + XML/JSON parsing
        const toolDescriptions = toolSchemas
            .map(
                (tool) =>
                    `- ${tool.function.name}: ${tool.function.description} Parameters: ${JSON.stringify(tool.function.parameters)}`
            )
            .join('\n');
        const textFallbackSystemPrompt = [
            systemPrompt,
            '',
            'Available tools:',
            toolDescriptions,
            '',
            'Respond with a JSON array of tool calls: [{"name":"tool_name","arguments":{...}}]',
            'Output only valid JSON. Do not include prose or markdown.',
        ].join('\n');
        let nativeCompletion: Promise<string>;
        if (signal === undefined) {
            nativeCompletion = generateNativeCompletion(textFallbackSystemPrompt, userMessage);
        } else {
            nativeCompletion = generateNativeCompletion(textFallbackSystemPrompt, userMessage, { signal });
        }
        const content = await waitForInference(nativeCompletion, signal);
        logger.info(
            `[AI Engine] (native/text) Raw response (${String(content.length)} chars): ${content.slice(0, 500)}`
        );
        return parseToolCallXml(content);
    }

    return async function generateToolCalls(
        systemPrompt: string,
        userMessage: string,
        toolSchemas?: readonly ToolSchema[],
        signal?: AbortSignal
    ): Promise<ToolCallResult[]> {
        const chain = getBackendChain();
        const availableTools = toolSchemas ?? DAW_TOOL_SCHEMAS;

        if (signal?.aborted) {
            throw createToolPlanningAbortError();
        }

        if (chain.length === 0) {
            throw createAiRuntimeError(
                'No AI backend available. Configure a cloud API key, or use a WebGPU-capable browser.'
            );
        }

        const previousStatus = llmStatusStore.value;
        llmStatusStore.set({ state: 'generating' });

        let lastError: Error | null = null;

        for (const backend of chain) {
            try {
                if (signal?.aborted) {
                    throw createToolPlanningAbortError();
                }
                let results: ToolCallResult[];

                if (backend === 'cloud') {
                    let cloudInference: Promise<ToolCallResult[]>;
                    if (signal === undefined) {
                        cloudInference = generateCloudToolCalls(systemPrompt, userMessage, availableTools);
                    } else {
                        cloudInference = generateCloudToolCalls(systemPrompt, userMessage, availableTools, signal);
                    }
                    results = await waitForInference(cloudInference, signal);
                } else if (backend === 'webllm') {
                    if (!isWebLlmLoaded()) {
                        await waitForInference(initWebLlmEngine(undefined, { signal }), signal);
                    }
                    const relevantTools =
                        toolSchemas === undefined
                            ? selectToolsForPrompt(availableTools, userMessage)
                            : [...availableTools];
                    logger.info(
                        `[AI Engine] (webllm) Using ${String(relevantTools.length)}/${String(availableTools.length)} tools`
                    );
                    results = await waitForInference(
                        generateWebLlmToolCalls(systemPrompt, userMessage, relevantTools, signal),
                        signal
                    );
                } else {
                    // Native backend: prefer structured tool calling via mistral.rs
                    if (!isNativeEngineReady()) {
                        throw createAiRuntimeError('Native AI engine not running');
                    }
                    results = await generateNativeToolCalls(systemPrompt, userMessage, availableTools, signal);
                }

                logger.info(
                    `[AI Engine] (${backend}) ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`
                );

                const modelId = (() => {
                    if (backend === 'native') {
                        return 'native';
                    }
                    if (backend === 'cloud') {
                        return getCloudProviderInfo()?.model ?? 'cloud';
                    }
                    return WEBLLM_MODEL_ID;
                })();
                llmStatusStore.set({ state: 'ready', backend, modelId });
                return results;
            } catch (error) {
                if (isAiRuntimeConfigurationChangedError(error)) {
                    llmStatusStore.set({ state: 'idle' });
                    throw error;
                }
                if (signal?.aborted) {
                    const currentPreference = aiBackendPreferenceStore.value ?? 'auto';
                    if (
                        currentPreference !== 'auto' &&
                        previousStatus?.state === 'ready' &&
                        previousStatus.backend !== currentPreference
                    ) {
                        llmStatusStore.set({ state: 'idle' });
                    } else {
                        llmStatusStore.set(previousStatus);
                    }
                    throw createToolPlanningAbortError();
                }
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn(`[AI Engine] Backend "${backend}" failed: ${lastError.message}. Trying next...`);
            }
        }

        llmStatusStore.set({ state: 'error', message: lastError?.message ?? 'All backends failed' });
        throw lastError ?? new Error('All AI backends failed');
    };
});
