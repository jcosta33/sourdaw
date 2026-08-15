import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type CompiledModelProviderRequest,
    type ModelProviderCapabilities,
    type ModelProviderEvent,
    type ModelProviderFailure,
    type ModelProviderFinish,
    type ModelProviderName,
    type ModelProviderPartialOutputDisposition,
    type ModelProviderProtocol,
    type ModelProviderRequest,
    type ModelProviderRequestInput,
    type ModelProviderResult,
    type ModelProviderSession,
    type ModelProviderUsage,
} from '../models/ModelProviderProtocol';

const LOCAL_CAPABILITIES = {
    cacheControls: ['provider-default'],
    dataPolicies: ['local-only', 'remote-allowed'],
    media: { audio: 'unavailable', image: 'unavailable', video: 'unavailable' },
    reasoningControls: ['provider-default'],
    streaming: true,
    text: true,
} as const;

const REMOTE_CAPABILITIES = {
    cacheControls: ['provider-default'],
    dataPolicies: ['remote-allowed'],
    media: { audio: 'unavailable', image: 'unavailable', video: 'unavailable' },
    reasoningControls: ['provider-default'],
    streaming: true,
    text: true,
} as const;

const CAPABILITIES: Record<ModelProviderName, ModelProviderCapabilities> = {
    native: {
        ...LOCAL_CAPABILITIES,
        contextWindowTokens: null,
        maxOutputTokens: null,
        parallelToolCalls: false,
        structuredOutput: true,
        tools: true,
    },
    webllm: {
        ...LOCAL_CAPABILITIES,
        contextWindowTokens: null,
        maxOutputTokens: null,
        parallelToolCalls: false,
        structuredOutput: false,
        tools: true,
    },
    anthropic: {
        ...REMOTE_CAPABILITIES,
        contextWindowTokens: null,
        maxOutputTokens: null,
        parallelToolCalls: false,
        structuredOutput: false,
        tools: true,
    },
    openai: {
        ...REMOTE_CAPABILITIES,
        contextWindowTokens: null,
        maxOutputTokens: null,
        parallelToolCalls: false,
        structuredOutput: false,
        tools: true,
    },
    'openai-compatible': {
        ...REMOTE_CAPABILITIES,
        contextWindowTokens: null,
        maxOutputTokens: null,
        parallelToolCalls: false,
        structuredOutput: false,
        tools: true,
    },
};

type CreateModelProviderProtocolInput = {
    provider: ModelProviderName;
    model?: string | null;
};

function hasOutput(result: Pick<ModelProviderResult, 'output'>): boolean {
    return (
        result.output.text.length > 0 ||
        result.output.reasoning.length > 0 ||
        result.output.toolCalls.length > 0 ||
        result.output.structuredOutput !== null
    );
}

function unavailableFailure(input: { code: string; correlationId: string; safeMessage: string }): ModelProviderFailure {
    return {
        ...input,
        retryable: false,
        partialOutputDisposition: 'none',
    };
}

function compileRequest(
    provider: ModelProviderName,
    capabilities: ModelProviderCapabilities,
    input: ModelProviderRequestInput
): CompiledModelProviderRequest {
    const unavailable = (code: string, safeMessage: string): CompiledModelProviderRequest => ({
        status: 'unavailable',
        failure: unavailableFailure({ code, correlationId: input.correlationId, safeMessage }),
    });
    if (input.modality !== 'text' && capabilities.media[input.modality] !== 'available') {
        return unavailable(
            'modality-unavailable',
            `The ${provider} provider does not support ${input.modality} input.`
        );
    }
    if (input.operation === 'text' && !capabilities.text) {
        return unavailable('text-unavailable', `The ${provider} provider does not support text generation.`);
    }
    if (input.operation === 'tools' && !capabilities.tools) {
        return unavailable('tools-unavailable', `The ${provider} provider does not support tool calls.`);
    }
    if (input.operation === 'structured-output' && !capabilities.structuredOutput) {
        return unavailable(
            'structured-output-unavailable',
            `The ${provider} provider does not support structured output.`
        );
    }
    if (input.stream && !capabilities.streaming) {
        return unavailable('streaming-unavailable', `The ${provider} provider does not support streaming.`);
    }
    if (input.allowParallelToolCalls === true && !capabilities.parallelToolCalls) {
        return unavailable(
            'parallel-tools-unavailable',
            `The ${provider} provider does not support parallel tool calls.`
        );
    }
    if (!capabilities.cacheControls.includes(input.controls.cache)) {
        return unavailable(
            'cache-control-unavailable',
            `The ${provider} provider does not support the requested cache control.`
        );
    }
    if (!capabilities.reasoningControls.includes(input.controls.reasoning)) {
        return unavailable(
            'reasoning-control-unavailable',
            `The ${provider} provider does not support the requested reasoning control.`
        );
    }
    if (!capabilities.dataPolicies.includes(input.dataPolicy)) {
        return unavailable(
            'data-policy-unavailable',
            `The ${provider} provider cannot satisfy the requested data policy.`
        );
    }
    if (
        capabilities.contextWindowTokens !== null &&
        input.limits.maxContextTokens !== undefined &&
        input.limits.maxContextTokens > capabilities.contextWindowTokens
    ) {
        return unavailable('context-limit-unavailable', `The ${provider} provider cannot satisfy the context limit.`);
    }
    if (capabilities.maxOutputTokens !== null && input.limits.maxOutputTokens > capabilities.maxOutputTokens) {
        return unavailable('output-limit-unavailable', `The ${provider} provider cannot satisfy the output limit.`);
    }
    if (input.operation === 'structured-output' && input.responseSchema === undefined) {
        return unavailable('invalid-request', 'Structured output requires a response schema.');
    }
    if (
        input.correlationId.trim().length === 0 ||
        input.messages.length === 0 ||
        input.messages.some((message) => message.content.length === 0) ||
        input.limits.maxOutputTokens <= 0 ||
        input.budget.maxInputTokens < 0 ||
        input.budget.maxOutputTokens < 0 ||
        input.budget.maxTotalTokens < 0
    ) {
        return unavailable('invalid-request', 'The model provider request is invalid.');
    }

    return {
        status: 'ready',
        request: {
            ...structuredClone(input),
            schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        },
    };
}

function createSession(input: {
    provider: ModelProviderName;
    model: string | null;
    request: ModelProviderRequest;
}): ModelProviderSession {
    let text = '';
    let reasoning = '';
    let structuredOutput: unknown = null;
    const toolCalls: ModelProviderResult['output']['toolCalls'] = [];
    const ignoredProviderEvents: string[] = [];
    let usage: ModelProviderUsage = {
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        reasoningTokens: null,
        provenance: 'unavailable',
    };

    function applyUsage(
        mode: 'delta' | 'cumulative-snapshot' | 'final',
        next: Omit<ModelProviderUsage, 'provenance'>,
        provenance: ModelProviderUsage['provenance']
    ): void {
        if (mode === 'delta') {
            usage = {
                inputTokens: (usage.inputTokens ?? 0) + (next.inputTokens ?? 0),
                outputTokens: (usage.outputTokens ?? 0) + (next.outputTokens ?? 0),
                cachedInputTokens: (usage.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0),
                reasoningTokens: (usage.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
                provenance,
            };
            return;
        }
        usage = {
            inputTokens: next.inputTokens ?? usage.inputTokens,
            outputTokens: next.outputTokens ?? usage.outputTokens,
            cachedInputTokens: next.cachedInputTokens ?? usage.cachedInputTokens,
            reasoningTokens: next.reasoningTokens ?? usage.reasoningTokens,
            provenance,
        };
    }

    function createFailure(
        failure: Pick<ModelProviderFailure, 'code' | 'retryable' | 'safeMessage'>,
        disposition: ModelProviderPartialOutputDisposition
    ): ModelProviderFailure {
        return {
            ...failure,
            correlationId: input.request.correlationId,
            partialOutputDisposition: disposition,
        };
    }

    function resultForFinish(finish: ModelProviderFinish): ModelProviderResult {
        const base: ModelProviderResult = {
            schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
            provider: input.provider,
            model: input.model,
            correlationId: input.request.correlationId,
            status: 'complete',
            output: {
                text,
                reasoning,
                toolCalls: structuredClone(toolCalls),
                structuredOutput: structuredClone(structuredOutput),
            },
            usage: { ...usage },
            finishReason: finish.reason,
            partialOutputDisposition: 'none',
            failure: null,
            ignoredProviderEvents: [...ignoredProviderEvents],
        };
        const outputExists = hasOutput(base);
        const inputTokens = usage.inputTokens ?? 0;
        const outputTokens = usage.outputTokens ?? 0;
        const exceedsBudget =
            inputTokens > input.request.budget.maxInputTokens ||
            outputTokens > input.request.budget.maxOutputTokens ||
            inputTokens + outputTokens > input.request.budget.maxTotalTokens;
        if (exceedsBudget) {
            const disposition = outputExists ? 'preserve' : 'discard';
            return {
                ...base,
                status: outputExists ? 'partial' : 'failed',
                partialOutputDisposition: disposition,
                failure: createFailure(
                    {
                        code: 'budget-exhausted',
                        retryable: false,
                        safeMessage: 'The model provider response exceeded the admitted token budget.',
                    },
                    disposition
                ),
            };
        }
        if (finish.reason === 'stop') {
            return base;
        }
        const disposition = outputExists ? 'preserve' : 'discard';
        if (finish.reason === 'cancelled') {
            return {
                ...base,
                status: 'cancelled',
                partialOutputDisposition: disposition,
                failure: createFailure(
                    { code: 'cancelled', retryable: true, safeMessage: 'The model provider request was cancelled.' },
                    disposition
                ),
            };
        }
        if (finish.reason === 'length') {
            return {
                ...base,
                status: outputExists ? 'partial' : 'failed',
                partialOutputDisposition: disposition,
                failure: createFailure(
                    {
                        code: 'output-limit',
                        retryable: true,
                        safeMessage: 'The model provider stopped at its output limit.',
                    },
                    disposition
                ),
            };
        }
        return {
            ...base,
            status: outputExists ? 'partial' : 'failed',
            partialOutputDisposition: disposition,
            failure: createFailure(finish.failure, disposition),
        };
    }

    return {
        push(event: ModelProviderEvent): void {
            if (event.type === 'text') {
                text = event.mode === 'delta' ? `${text}${event.text}` : event.text;
                return;
            }
            if (event.type === 'reasoning') {
                reasoning = event.mode === 'delta' ? `${reasoning}${event.text}` : event.text;
                return;
            }
            if (event.type === 'tool-call') {
                toolCalls.push(structuredClone(event.call));
                return;
            }
            if (event.type === 'structured-output') {
                structuredOutput = structuredClone(event.value);
                return;
            }
            if (event.type === 'usage') {
                applyUsage(event.mode, event.usage, event.provenance);
                return;
            }
            ignoredProviderEvents.push(event.providerEventType);
        },
        finish: resultForFinish,
    };
}

export function createModelProviderProtocol(input: CreateModelProviderProtocolInput): ModelProviderProtocol {
    const capabilities = structuredClone(CAPABILITIES[input.provider]);
    return {
        capabilities,
        compileRequest: (request) => compileRequest(input.provider, capabilities, request),
        start: (request) => {
            const session = createSession({ provider: input.provider, model: input.model ?? null, request });
            return {
                push(event) {
                    session.push(event);
                },
                finish(finish) {
                    return session.finish(finish);
                },
            };
        },
    };
}
