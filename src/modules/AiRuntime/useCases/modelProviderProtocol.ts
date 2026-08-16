import { AGENT_DATA_CATEGORIES, classifyAgentDataPolicy, type AgentDataCategory } from '../models/AgentDataPolicy';
import {
    MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
    type CompiledModelProviderRequest,
    type ModelProviderCapabilities,
    type ModelProviderEvent,
    type ModelProviderEventEnvelope,
    type ModelProviderFailure,
    type ModelProviderFinish,
    type ModelProviderFinishEnvelope,
    type ModelProviderName,
    type ModelProviderPartialOutputDisposition,
    type ModelProviderProtocol,
    type ModelProviderRequest,
    type ModelProviderRequestInput,
    type ModelProviderResult,
    type ModelProviderSession,
    type ModelProviderUsage,
} from '../models/ModelProviderProtocol';

import { remoteTransmissionDisclosure } from './discloseRemoteTransmission';

const MAX_MODEL_PROVIDER_EVENT_BYTES = 64 * 1_024;
const MAX_MODEL_PROVIDER_REQUEST_BYTES = 1_024 * 1_024;
const MAX_MODEL_PROVIDER_STREAM_BYTES = 1_024 * 1_024;
const MAX_MODEL_PROVIDER_EVENTS = 4_096;
const MAX_IGNORED_PROVIDER_EVENTS = 64;
const MAX_PROVIDER_TOOL_CALLS = 64;
const MAX_PROVIDER_ID_LENGTH = 256;

function hasAdmissibleRemoteDataCategories(categories: unknown): categories is AgentDataCategory[] {
    return (
        Array.isArray(categories) &&
        categories.length > 0 &&
        categories.every((category) => AGENT_DATA_CATEGORIES.some((known) => known === category)) &&
        new Set(categories).size === categories.length
    );
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodedJsonBytes(value: unknown): number {
    let serialized: string | undefined;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw new TypeError('Provider stream payload is not valid bounded JSON.');
    }
    if (serialized === undefined) {
        throw new TypeError('Provider stream payload is not valid bounded JSON.');
    }
    return new TextEncoder().encode(serialized).byteLength;
}

function isJsonValue(value: unknown, depth = 0): boolean {
    if (depth > 64) {
        return false;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every((item) => isJsonValue(item, depth + 1));
    }
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        return false;
    }
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function matchesSchemaType(value: unknown, type: unknown): boolean {
    if (Array.isArray(type)) {
        return type.some((entry) => matchesSchemaType(value, entry));
    }
    if (type === 'null') {
        return value === null;
    }
    if (type === 'object') {
        return isRecord(value);
    }
    if (type === 'array') {
        return Array.isArray(value);
    }
    if (type === 'string') {
        return typeof value === 'string';
    }
    if (type === 'boolean') {
        return typeof value === 'boolean';
    }
    if (type === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
    }
    if (type === 'integer') {
        return typeof value === 'number' && Number.isSafeInteger(value);
    }
    return false;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((item, index) => jsonValuesEqual(item, right[index]));
    }
    if (isRecord(left) && isRecord(right)) {
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        return (
            leftKeys.length === rightKeys.length &&
            leftKeys.every((key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]))
        );
    }
    return false;
}

function matchesJsonSchema(value: unknown, schema: unknown, depth = 0): boolean {
    if (depth > 64) {
        return false;
    }
    if (typeof schema === 'boolean') {
        return schema;
    }
    if (!isRecord(schema) || !isJsonValue(value)) {
        return false;
    }
    if (
        Array.isArray(schema.oneOf) &&
        schema.oneOf.filter((member) => matchesJsonSchema(value, member, depth + 1)).length !== 1
    ) {
        return false;
    }
    if (Array.isArray(schema.anyOf) && !schema.anyOf.some((member) => matchesJsonSchema(value, member, depth + 1))) {
        return false;
    }
    if (Array.isArray(schema.allOf) && !schema.allOf.every((member) => matchesJsonSchema(value, member, depth + 1))) {
        return false;
    }
    if (schema.not !== undefined && matchesJsonSchema(value, schema.not, depth + 1)) {
        return false;
    }
    if ('const' in schema && !jsonValuesEqual(value, schema.const)) {
        return false;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonValuesEqual(entry, value))) {
        return false;
    }
    if (schema.type !== undefined && !matchesSchemaType(value, schema.type)) {
        return false;
    }
    if (typeof value === 'string') {
        if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
            return false;
        }
        if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
            return false;
        }
        if (typeof schema.pattern === 'string') {
            try {
                if (!new RegExp(schema.pattern, 'u').test(value)) {
                    return false;
                }
            } catch {
                return false;
            }
        }
    }
    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum) {
            return false;
        }
        if (typeof schema.maximum === 'number' && value > schema.maximum) {
            return false;
        }
        if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
            return false;
        }
        if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
            return false;
        }
    }
    if (Array.isArray(value)) {
        if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
            return false;
        }
        if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
            return false;
        }
        if (
            schema.uniqueItems === true &&
            value.some((item, index) => value.slice(index + 1).some((candidate) => jsonValuesEqual(item, candidate)))
        ) {
            return false;
        }
        if (schema.items !== undefined && !value.every((item) => matchesJsonSchema(item, schema.items, depth + 1))) {
            return false;
        }
    }
    if (isRecord(value)) {
        const properties = isRecord(schema.properties) ? schema.properties : {};
        if (Array.isArray(schema.required)) {
            for (const required of schema.required) {
                if (typeof required !== 'string' || !(required in value)) {
                    return false;
                }
            }
        }
        for (const [key, item] of Object.entries(value)) {
            if (key in properties) {
                if (!matchesJsonSchema(item, properties[key], depth + 1)) {
                    return false;
                }
                continue;
            }
            if (schema.additionalProperties === false) {
                return false;
            }
            if (isRecord(schema.additionalProperties) || typeof schema.additionalProperties === 'boolean') {
                if (!matchesJsonSchema(item, schema.additionalProperties, depth + 1)) {
                    return false;
                }
            }
        }
    }
    return true;
}

function isValidIdentityPart(value: string): boolean {
    return value.trim().length > 0 && value.length <= MAX_PROVIDER_ID_LENGTH;
}

function isUsageCounter(value: unknown): value is number | null {
    return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function assertProviderEventShape(value: unknown): asserts value is ModelProviderEvent {
    if (!isRecord(value) || typeof value.type !== 'string') {
        throw new TypeError('Provider stream event has an invalid runtime shape.');
    }
    if (value.type === 'text' || value.type === 'reasoning') {
        if ((value.mode !== 'delta' && value.mode !== 'cumulative-snapshot') || typeof value.text !== 'string') {
            throw new TypeError('Provider stream event has an invalid runtime shape.');
        }
        return;
    }
    if (value.type === 'tool-call') {
        if (
            !isRecord(value.call) ||
            typeof value.call.id !== 'string' ||
            typeof value.call.name !== 'string' ||
            !isRecord(value.call.arguments) ||
            !isJsonValue(value.call.arguments)
        ) {
            throw new TypeError('Provider stream event has an invalid runtime shape.');
        }
        return;
    }
    if (value.type === 'structured-output') {
        if (!('value' in value) || !isJsonValue(value.value)) {
            throw new TypeError('Provider stream event has an invalid runtime shape.');
        }
        return;
    }
    if (value.type === 'usage') {
        if (
            (value.mode !== 'delta' && value.mode !== 'cumulative-snapshot' && value.mode !== 'final') ||
            !isRecord(value.usage) ||
            !isUsageCounter(value.usage.inputTokens) ||
            !isUsageCounter(value.usage.outputTokens) ||
            !isUsageCounter(value.usage.cachedInputTokens) ||
            !isUsageCounter(value.usage.reasoningTokens) ||
            (value.provenance !== 'provider-reported' &&
                value.provenance !== 'versioned-estimate' &&
                value.provenance !== 'unavailable')
        ) {
            throw new TypeError('Provider stream event has an invalid runtime shape.');
        }
        return;
    }
    if (value.type === 'unknown') {
        if (typeof value.providerEventType !== 'string') {
            throw new TypeError('Provider stream event has an invalid runtime shape.');
        }
        return;
    }
    throw new TypeError('Provider stream event has an invalid runtime shape.');
}

function assertProviderFinishShape(value: unknown): asserts value is ModelProviderFinish {
    if (!isRecord(value) || typeof value.reason !== 'string') {
        throw new TypeError('Provider stream terminal has an invalid runtime shape.');
    }
    if (value.reason === 'stop' || value.reason === 'length' || value.reason === 'cancelled') {
        return;
    }
    if (value.reason !== 'error' && value.reason !== 'refusal') {
        throw new TypeError('Provider stream terminal has an invalid runtime shape.');
    }
    if (
        !isRecord(value.failure) ||
        typeof value.failure.code !== 'string' ||
        !isValidIdentityPart(value.failure.code) ||
        typeof value.failure.retryable !== 'boolean' ||
        typeof value.failure.safeMessage !== 'string' ||
        value.failure.safeMessage.trim().length === 0
    ) {
        throw new TypeError('Provider stream terminal has an invalid runtime shape.');
    }
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
    if (input.dataPolicy === 'remote-allowed' && capabilities.dataPolicies.length === 1) {
        const categories = input.dataCategories;
        const disclosure = input.remoteDisclosure;
        if (
            !hasAdmissibleRemoteDataCategories(categories) ||
            !remoteTransmissionDisclosure.matches({
                evidence: disclosure,
                categories,
                correlationId: input.correlationId,
                requestId: input.requestId ?? input.correlationId,
            }) ||
            classifyAgentDataPolicy({ destination: 'provider', categories }).transmission !== 'allowed'
        ) {
            return unavailable(
                'remote-data-policy-rejected',
                'The hosted provider request lacks admitted data disclosure.'
            );
        }
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
        !isValidIdentityPart(input.correlationId) ||
        (input.runId !== undefined && !isValidIdentityPart(input.runId)) ||
        (input.requestId !== undefined && !isValidIdentityPart(input.requestId)) ||
        (input.cancellationGeneration !== undefined &&
            (!Number.isSafeInteger(input.cancellationGeneration) || input.cancellationGeneration < 0)) ||
        input.messages.length === 0 ||
        input.messages.some((message) => message.content.length === 0) ||
        input.limits.maxOutputTokens <= 0 ||
        input.budget.maxInputTokens < 0 ||
        input.budget.maxOutputTokens < 0 ||
        input.budget.maxTotalTokens < 0
    ) {
        return unavailable('invalid-request', 'The model provider request is invalid.');
    }
    try {
        if (encodedJsonBytes(input) > MAX_MODEL_PROVIDER_REQUEST_BYTES) {
            return unavailable('invalid-request', 'The model provider request exceeds its size limit.');
        }
    } catch {
        return unavailable('invalid-request', 'The model provider request is not valid bounded JSON.');
    }

    const request: ModelProviderRequest = {
        ...structuredClone(input),
        runId: input.runId ?? input.correlationId,
        requestId: input.requestId ?? input.correlationId,
        cancellationGeneration: input.cancellationGeneration ?? 0,
        schemaVersion: MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION,
        ...(input.remoteDisclosure === undefined ? {} : { remoteDisclosure: input.remoteDisclosure }),
    };
    return {
        status: 'ready',
        request,
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
    const toolCallIds = new Set<string>();
    let nextSequence = 0;
    let streamBytes = 0;
    let eventCount = 0;
    let finished = false;
    let usage: ModelProviderUsage = {
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        reasoningTokens: null,
        provenance: 'unavailable',
    };

    function assertIdentity(envelope: ModelProviderEventEnvelope | ModelProviderFinishEnvelope): void {
        if (envelope.schemaVersion !== MODEL_PROVIDER_PROTOCOL_SCHEMA_VERSION) {
            throw new TypeError('Provider stream schema version does not match the admitted request.');
        }
        if (envelope.runId !== input.request.runId) {
            throw new TypeError('Provider stream run identity does not match the admitted request.');
        }
        if (envelope.requestId !== input.request.requestId) {
            throw new TypeError('Provider stream request identity does not match the admitted request.');
        }
        if (envelope.correlationId !== input.request.correlationId) {
            throw new TypeError('Provider stream correlation identity does not match the admitted request.');
        }
        if (envelope.cancellationGeneration !== input.request.cancellationGeneration) {
            throw new TypeError('Provider stream cancellation generation does not match the admitted request.');
        }
        if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence !== nextSequence) {
            throw new TypeError('Provider stream sequence is not the next admitted event.');
        }
    }

    function assertActive(): void {
        if (finished) {
            throw new TypeError('Provider stream already emitted its terminal outcome.');
        }
    }

    function admitEvent(envelope: ModelProviderEventEnvelope): ModelProviderEvent {
        assertActive();
        assertIdentity(envelope);
        const eventBytes = encodedJsonBytes(envelope.event);
        if (eventBytes > MAX_MODEL_PROVIDER_EVENT_BYTES) {
            throw new TypeError('Provider stream event payload exceeds its size limit.');
        }
        if (eventCount >= MAX_MODEL_PROVIDER_EVENTS || streamBytes + eventBytes > MAX_MODEL_PROVIDER_STREAM_BYTES) {
            throw new TypeError('Provider stream exceeds its bounded event or payload limit.');
        }
        assertProviderEventShape(envelope.event);
        const event = envelope.event;
        if (event.type === 'text') {
            const nextText = event.mode === 'delta' ? `${text}${event.text}` : event.text;
            if (new TextEncoder().encode(nextText).byteLength > MAX_MODEL_PROVIDER_STREAM_BYTES) {
                throw new TypeError('Provider stream accumulated text exceeds its size limit.');
            }
        }
        if (event.type === 'reasoning') {
            const nextReasoning = event.mode === 'delta' ? `${reasoning}${event.text}` : event.text;
            if (new TextEncoder().encode(nextReasoning).byteLength > MAX_MODEL_PROVIDER_STREAM_BYTES) {
                throw new TypeError('Provider stream accumulated reasoning exceeds its size limit.');
            }
        }
        if (event.type === 'tool-call') {
            const advertisedTool = input.request.tools?.find((tool) => tool.name === event.call.name);
            if (advertisedTool === undefined) {
                throw new TypeError('Provider stream requested a tool that was not advertised.');
            }
            if (
                !isValidIdentityPart(event.call.id) ||
                !isValidIdentityPart(event.call.name) ||
                toolCallIds.has(event.call.id) ||
                toolCalls.length >= MAX_PROVIDER_TOOL_CALLS ||
                !matchesJsonSchema(event.call.arguments, advertisedTool.parameters)
            ) {
                throw new TypeError('Provider stream tool arguments are incomplete or invalid.');
            }
        }
        if (event.type === 'structured-output') {
            if (
                input.request.operation !== 'structured-output' ||
                input.request.responseSchema === undefined ||
                !matchesJsonSchema(event.value, input.request.responseSchema)
            ) {
                throw new TypeError('Provider stream structured output is invalid.');
            }
        }
        if (
            event.type === 'unknown' &&
            (!isValidIdentityPart(event.providerEventType) ||
                ignoredProviderEvents.length >= MAX_IGNORED_PROVIDER_EVENTS)
        ) {
            throw new TypeError('Provider stream unknown-event retention limit was exceeded.');
        }
        nextSequence += 1;
        eventCount += 1;
        streamBytes += eventBytes;
        return event;
    }

    function applyUsage(
        mode: 'delta' | 'cumulative-snapshot' | 'final',
        next: Omit<ModelProviderUsage, 'provenance'>,
        provenance: ModelProviderUsage['provenance']
    ): void {
        if (mode === 'delta') {
            const addCounter = (current: number | null, delta: number | null): number | null =>
                delta === null ? current : (current ?? 0) + delta;
            usage = {
                inputTokens: addCounter(usage.inputTokens, next.inputTokens),
                outputTokens: addCounter(usage.outputTokens, next.outputTokens),
                cachedInputTokens: addCounter(usage.cachedInputTokens, next.cachedInputTokens),
                reasoningTokens: addCounter(usage.reasoningTokens, next.reasoningTokens),
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
        push(envelope: ModelProviderEventEnvelope): void {
            const event = admitEvent(envelope);
            if (event.type === 'text') {
                text = event.mode === 'delta' ? `${text}${event.text}` : event.text;
                return;
            }
            if (event.type === 'reasoning') {
                reasoning = event.mode === 'delta' ? `${reasoning}${event.text}` : event.text;
                return;
            }
            if (event.type === 'tool-call') {
                toolCallIds.add(event.call.id);
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
        finish(envelope: ModelProviderFinishEnvelope): ModelProviderResult {
            assertActive();
            assertIdentity(envelope);
            if (encodedJsonBytes(envelope.finish) > MAX_MODEL_PROVIDER_EVENT_BYTES) {
                throw new TypeError('Provider stream terminal payload exceeds its size limit.');
            }
            assertProviderFinishShape(envelope.finish);
            finished = true;
            nextSequence += 1;
            return resultForFinish(envelope.finish);
        },
    };
}

export function createModelProviderProtocol(input: CreateModelProviderProtocolInput): ModelProviderProtocol {
    const capabilities = structuredClone(CAPABILITIES[input.provider]);
    return {
        capabilities,
        compileRequest: (request) => compileRequest(input.provider, capabilities, request),
        start: (request) => {
            if (request.dataPolicy === 'remote-allowed' && capabilities.dataPolicies.length === 1) {
                const categories = request.dataCategories;
                if (
                    !hasAdmissibleRemoteDataCategories(categories) ||
                    !remoteTransmissionDisclosure.consume({
                        evidence: request.remoteDisclosure,
                        categories,
                        correlationId: request.correlationId,
                        requestId: request.requestId,
                    }) ||
                    classifyAgentDataPolicy({ destination: 'provider', categories }).transmission !== 'allowed'
                ) {
                    throw new TypeError('The hosted provider request lacks admitted data disclosure.');
                }
            }
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
