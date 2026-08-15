import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { selectExecutableAppActionToolSchemasForPrompt } from '#/modules/Command/useCases';

import { isAiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { createModelProviderFailureError } from '../../errors/ModelProviderFailureError';
import { isNativeToolCallingProtocolError } from '../../errors/NativeToolCallingProtocolError';
import { isToolPlanningRejectedError } from '../../errors/ToolPlanningRejectedError';
import { PROJECT_QUERY_TOOL_NAME } from '../../models/ApplicationOwnedTool';
import { type RunnableAiBackend } from '../../models/LlmOrchestrationTypes';
import { WEBLLM_MODEL_ID } from '../../models/ModelInfo';
import {
    type ModelProviderName,
    type ModelProviderResult,
    type ModelProviderSession,
} from '../../models/ModelProviderProtocol';
import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../../models/ToolDefinitions';
import { WORKFLOW_CAPABILITY_ACTION_TOOL_NAMES, WORKFLOW_CAPABILITY_TOOL_NAME } from '../../models/WorkflowCapability';
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
import {
    parseToolPlanningOutcome,
    type ToolCallResult,
    type ToolPlanningOutcome,
} from '../../transformers/toolCallParser';
import { createModelProviderProtocol } from '../modelProviderProtocol';

import { getBackendChain } from './backendResolution/getBackendChain';

function createToolPlanningAbortError(): Error {
    const error = new Error('AI tool planning aborted');
    error.name = 'AbortError';
    return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function normalizeGeneratedToolPlanningOutcome(value: unknown): ToolPlanningOutcome {
    if (!isRecord(value)) {
        return { status: 'rejected', reason: 'The model provider returned an invalid planning result.' };
    }
    if (value.status === 'rejected' && typeof value.reason === 'string') {
        return { status: 'rejected', reason: value.reason };
    }
    if (value.status !== 'complete' || !isUnknownArray(value.toolCalls)) {
        return { status: 'rejected', reason: 'The model provider returned an invalid planning result.' };
    }
    const toolCalls: ToolCallResult[] = [];
    for (const call of value.toolCalls) {
        if (!isRecord(call)) {
            return { status: 'rejected', reason: 'The model provider returned an invalid planning result.' };
        }
        if (
            typeof call.name !== 'string' ||
            typeof call.arguments !== 'object' ||
            call.arguments === null ||
            Array.isArray(call.arguments)
        ) {
            return { status: 'rejected', reason: 'The model provider returned an invalid planning result.' };
        }
        if (call.id !== undefined && (typeof call.id !== 'string' || call.id.length === 0)) {
            return { status: 'rejected', reason: 'The model provider returned an invalid planning result.' };
        }
        toolCalls.push({
            ...(typeof call.id === 'string' ? { id: call.id } : {}),
            name: call.name,
            arguments: Object.fromEntries(Object.entries(call.arguments)),
        });
    }
    return { status: 'complete', toolCalls };
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
            // Let an already-settled inference promise win this race.
            queueMicrotask(() => {
                reject(createToolPlanningAbortError());
            });
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
export const generateToolPlanningOutcome = inject({ logger })(({ logger }) => {
    function getBackendModelId(backend: RunnableAiBackend): string {
        if (backend === 'native') {
            return 'native';
        }
        if (backend === 'cloud') {
            return getCloudProviderInfo()?.model ?? 'cloud';
        }
        return WEBLLM_MODEL_ID;
    }

    function getProviderName(backend: RunnableAiBackend): ModelProviderName {
        if (backend === 'native' || backend === 'webllm') {
            return backend;
        }
        return getCloudProviderInfo()?.provider ?? 'openai-compatible';
    }

    async function generateNativeToolCalls(
        systemPrompt: string,
        userMessage: string,
        toolSchemas: readonly ToolSchema[],
        signal?: AbortSignal
    ): Promise<ToolPlanningOutcome> {
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
                return { status: 'complete', toolCalls: results };
            }
        } catch (error) {
            if (isToolPlanningRejectedError(error) || isNativeToolCallingProtocolError(error)) {
                throw error;
            }
            if (signal?.aborted) {
                if (error instanceof Error && error.name === 'AbortError') {
                    throw createToolPlanningAbortError();
                }
                throw error;
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
            'Respond with a JSON array of tool calls: [{"id":"unique_call_id","name":"tool_name","arguments":{...}}]',
            'Output only valid JSON. Do not include prose or markdown.',
        ].join('\n');
        let nativeCompletion: Promise<string>;
        if (signal === undefined) {
            nativeCompletion = generateNativeCompletion(textFallbackSystemPrompt, userMessage, {
                requireComplete: true,
            });
        } else {
            nativeCompletion = generateNativeCompletion(textFallbackSystemPrompt, userMessage, {
                signal,
                requireComplete: true,
            });
        }
        const content = await waitForInference(nativeCompletion, signal);
        logger.info(
            `[AI Engine] (native/text) Raw response (${String(content.length)} chars): ${content.slice(0, 500)}`
        );
        return parseToolPlanningOutcome(content);
    }

    return async function generateToolPlanningOutcome(
        systemPrompt: string,
        userMessage: string,
        toolSchemas?: readonly ToolSchema[],
        signal?: AbortSignal,
        toolSelectionPrompt: string = userMessage,
        onProviderResult?: (result: ModelProviderResult) => void
    ): Promise<ToolPlanningOutcome> {
        const chain = getBackendChain();
        const availableTools = toolSchemas ?? DAW_TOOL_SCHEMAS;
        const reportProviderResult = (result: ModelProviderResult): void => {
            try {
                onProviderResult?.(result);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`[AI Engine] Provider result observer failed: ${message}`);
            }
        };

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

        const failedBackends = new Set<RunnableAiBackend>();
        let lastError: Error | null = null;

        for (const backend of chain) {
            let providerSession: ModelProviderSession | null = null;
            let providerSessionSettled = false;
            try {
                if (signal?.aborted) {
                    throw createToolPlanningAbortError();
                }
                let providerTools = availableTools;
                if (backend === 'webllm') {
                    const workflowSelectionTools = availableTools.filter(
                        (tool) => tool.function.name === WORKFLOW_CAPABILITY_TOOL_NAME
                    );
                    const applicationTools = availableTools.filter(
                        (tool) => tool.function.name === PROJECT_QUERY_TOOL_NAME
                    );
                    const actionTools = availableTools.filter(
                        (tool) =>
                            tool.function.name !== WORKFLOW_CAPABILITY_TOOL_NAME &&
                            tool.function.name !== PROJECT_QUERY_TOOL_NAME
                    );
                    const selectedActionTools = selectExecutableAppActionToolSchemasForPrompt({
                        toolSchemas: actionTools,
                        prompt: toolSelectionPrompt,
                    });
                    const workflowActionToolNames = new Set<string>(WORKFLOW_CAPABILITY_ACTION_TOOL_NAMES);
                    const workflowActionTools =
                        workflowSelectionTools.length > 0
                            ? actionTools.filter((tool) => workflowActionToolNames.has(tool.function.name))
                            : [];
                    const mandatoryToolNames = new Set(
                        [...workflowSelectionTools, ...applicationTools, ...workflowActionTools].map(
                            (tool) => tool.function.name
                        )
                    );
                    const promptActionTools = selectedActionTools.filter(
                        (tool) => !mandatoryToolNames.has(tool.function.name)
                    );
                    providerTools = [
                        ...workflowSelectionTools,
                        ...applicationTools,
                        ...workflowActionTools,
                        ...promptActionTools,
                    ].slice(0, 30);
                    logger.info(
                        `[AI Engine] (webllm) Using ${String(providerTools.length)}/${String(availableTools.length)} tools`
                    );
                }
                const providerName = getProviderName(backend);
                const providerProtocol = createModelProviderProtocol({
                    provider: providerName,
                    model: getBackendModelId(backend),
                });
                const compiledRequest = providerProtocol.compileRequest({
                    correlationId: `tool-planning-${crypto.randomUUID()}`,
                    operation: 'tools',
                    modality: 'text',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage },
                    ],
                    tools: providerTools.map((tool) => ({
                        name: tool.function.name,
                        description: tool.function.description ?? '',
                        parameters: tool.function.parameters,
                    })),
                    stream: false,
                    limits: { maxOutputTokens: 2_048 },
                    controls: { cache: 'provider-default', reasoning: 'provider-default' },
                    budget: { maxInputTokens: 32_768, maxOutputTokens: 2_048, maxTotalTokens: 34_816 },
                    dataPolicy: backend === 'cloud' ? 'remote-allowed' : 'local-only',
                });
                if (compiledRequest.status !== 'ready') {
                    return { status: 'rejected', reason: compiledRequest.failure.safeMessage };
                }
                const providerRequest = compiledRequest.request;
                providerSession = providerProtocol.start(providerRequest);
                const providerSystemPrompt = providerRequest.messages.find(
                    (message) => message.role === 'system'
                )?.content;
                const providerUserMessage = providerRequest.messages.find(
                    (message) => message.role === 'user'
                )?.content;
                if (providerSystemPrompt === undefined || providerUserMessage === undefined) {
                    providerSession.finish({
                        reason: 'error',
                        failure: {
                            code: 'invalid-provider-request',
                            retryable: false,
                            safeMessage: 'The model provider request is missing required messages.',
                        },
                    });
                    providerSessionSettled = true;
                    return { status: 'rejected', reason: 'The model provider request is missing required messages.' };
                }
                let outcome: ToolPlanningOutcome;

                if (backend === 'cloud') {
                    let cloudInference: Promise<ToolCallResult[]>;
                    if (signal === undefined) {
                        cloudInference = generateCloudToolCalls(
                            providerSystemPrompt,
                            providerUserMessage,
                            providerTools
                        );
                    } else {
                        cloudInference = generateCloudToolCalls(
                            providerSystemPrompt,
                            providerUserMessage,
                            providerTools,
                            signal
                        );
                    }
                    const toolCalls = await waitForInference(cloudInference, signal);
                    outcome = { status: 'complete', toolCalls };
                } else if (backend === 'webllm') {
                    if (!isWebLlmLoaded()) {
                        await waitForInference(initWebLlmEngine(undefined, { signal }), signal);
                    }
                    const generatedInference = Promise.resolve<unknown>(
                        Reflect.apply(generateWebLlmToolCalls, undefined, [
                            providerSystemPrompt,
                            providerUserMessage,
                            providerTools,
                            signal,
                        ])
                    );
                    const generatedOutcome = await waitForInference(generatedInference, signal);
                    outcome = normalizeGeneratedToolPlanningOutcome(generatedOutcome);
                } else {
                    if (!isNativeEngineReady()) {
                        throw createAiRuntimeError('Native AI engine not running');
                    }
                    outcome = await generateNativeToolCalls(
                        providerSystemPrompt,
                        providerUserMessage,
                        providerTools,
                        signal
                    );
                }

                if (outcome.status === 'complete') {
                    const providerCallIds = outcome.toolCalls.map((call) => call.id);
                    for (const [index, call] of outcome.toolCalls.entries()) {
                        providerSession.push({
                            type: 'tool-call',
                            call: {
                                id: call.id ?? `${providerRequest.correlationId}:${String(index)}`,
                                name: call.name,
                                arguments: call.arguments,
                            },
                        });
                    }
                    const normalizedResult = providerSession.finish({ reason: 'stop' });
                    providerSessionSettled = true;
                    reportProviderResult(normalizedResult);
                    logger.info(
                        `[AI Engine] (${backend}) ${String(outcome.toolCalls.length)} tool call(s): ${outcome.toolCalls.map((call) => call.name).join(', ')}`
                    );
                    outcome = {
                        status: 'complete',
                        toolCalls: normalizedResult.output.toolCalls.map((call, index) => ({
                            ...(providerCallIds[index] === undefined ? {} : { id: providerCallIds[index] }),
                            name: call.name,
                            arguments: call.arguments,
                        })),
                    };
                } else {
                    const rejectedResult = providerSession.finish({
                        reason: 'error',
                        failure: {
                            code: 'tool-planning-rejected',
                            retryable: false,
                            safeMessage: outcome.reason,
                        },
                    });
                    providerSessionSettled = true;
                    reportProviderResult(rejectedResult);
                    logger.warn(`[AI Engine] (${backend}) tool planning rejected: ${outcome.reason}`);
                }

                llmStatusStore.set({ state: 'ready', backend, modelId: getBackendModelId(backend) });
                return outcome;
            } catch (error) {
                const isTerminalModelRejection = isToolPlanningRejectedError(error);
                const isExplicitAbort = error instanceof Error && error.name === 'AbortError';
                let normalizedAttemptError: Error | null = null;
                if (providerSession !== null && !providerSessionSettled) {
                    let failedResult: ModelProviderResult;
                    if (isAiRuntimeConfigurationChangedError(error) || isExplicitAbort || signal?.aborted) {
                        failedResult = providerSession.finish({ reason: 'cancelled' });
                    } else if (isTerminalModelRejection) {
                        failedResult = providerSession.finish({
                            reason: 'error',
                            failure: {
                                code: 'tool-planning-rejected',
                                retryable: false,
                                safeMessage: 'The model provider rejected tool planning.',
                            },
                        });
                    } else {
                        failedResult = providerSession.finish({
                            reason: 'error',
                            failure: {
                                code: 'provider-attempt-failed',
                                retryable: true,
                                safeMessage: 'The model provider request failed.',
                            },
                        });
                    }
                    reportProviderResult(failedResult);
                    if (failedResult.failure !== null) {
                        normalizedAttemptError = createModelProviderFailureError(failedResult.failure, error);
                    }
                }
                if (isAiRuntimeConfigurationChangedError(error)) {
                    llmStatusStore.set({ state: 'idle' });
                    throw error;
                }
                if (!isTerminalModelRejection && !isExplicitAbort) {
                    failedBackends.add(backend);
                }
                if (signal?.aborted) {
                    const currentPreference = aiBackendPreferenceStore.value ?? 'auto';
                    const previousBackendFailed =
                        previousStatus?.state === 'ready' && failedBackends.has(previousStatus.backend);
                    const preferenceChangedBackend =
                        currentPreference !== 'auto' &&
                        previousStatus?.state === 'ready' &&
                        previousStatus.backend !== currentPreference;
                    if (previousBackendFailed || preferenceChangedBackend) {
                        llmStatusStore.set({ state: 'idle' });
                    } else {
                        llmStatusStore.set(previousStatus);
                    }
                    throw createToolPlanningAbortError();
                }
                if (isTerminalModelRejection) {
                    llmStatusStore.set({ state: 'ready', backend, modelId: getBackendModelId(backend) });
                    return { status: 'rejected', reason: error.message };
                }
                lastError = normalizedAttemptError ?? (error instanceof Error ? error : new Error(String(error)));
                logger.warn(`[AI Engine] Backend "${backend}" failed: ${lastError.message}. Trying next...`);
            }
        }

        llmStatusStore.set({ state: 'error', message: lastError?.message ?? 'All backends failed' });
        throw lastError ?? new Error('All AI backends failed');
    };
});
