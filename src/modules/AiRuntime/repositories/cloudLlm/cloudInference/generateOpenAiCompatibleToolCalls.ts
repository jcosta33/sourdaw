import { HostedAiHttpStatusError } from '../../../errors/HostedAiHttpStatusError';
import { HostedToolCallingProtocolError } from '../../../errors/HostedToolCallingProtocolError';
import { isToolPlanningRejectedError, ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { type OpenAiCompatibleCloudRuntime } from '../cloudSession';

import { buildWireToolNameCodec } from './buildWireToolNameCodec';
import {
    type HostedToolChoiceDirective,
    type HostedToolPlan,
    type HostedToolPlanUsage,
    readHostedTokenCount,
} from './hostedToolPlan';
import { narrowToolSchemasForDirective } from './narrowToolSchemasForDirective';
import { parseToolCallArguments } from './parseToolCallArguments';
import { projectOpenAiStrictToolSchema } from './projectOpenAiStrictToolSchema';
import { readProviderRequestId } from './readProviderRequestId';
import { rejectedBatchMessage } from './rejectedBatchMessage';
import { requestHostedOpenAiProvider } from './requestOpenAiProvider';

type GenerateOpenAiCompatibleToolCallsInput = {
    runtime: OpenAiCompatibleCloudRuntime;
    systemPrompt: string;
    userMessage: string;
    toolSchemas: readonly ToolSchema[];
    maxOutputTokens: number;
    directive: HostedToolChoiceDirective;
    signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type AssistantContentState = { valid: true; hasContent: boolean } | { valid: false };

function inspectAssistantContent(value: unknown): AssistantContentState {
    if (value === undefined || value === null) {
        return { valid: true, hasContent: false };
    }
    if (typeof value === 'string') {
        return { valid: true, hasContent: value.trim().length > 0 };
    }
    if (!Array.isArray(value)) {
        return { valid: false };
    }

    let hasContent = false;
    for (const part of value) {
        if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') {
            return { valid: false };
        }
        if (part.text.trim().length > 0) {
            hasContent = true;
        }
    }
    return { valid: true, hasContent };
}

function parseToolCalls(response: unknown, decodeWireName: (wireName: string) => string): ToolCallResult[] {
    if (!isRecord(response) || !Array.isArray(response.choices)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    if (response.choices.length !== 1) {
        throw new HostedToolCallingProtocolError('Hosted AI returned an invalid response choice count');
    }
    const choices: unknown[] = response.choices;
    const firstChoice = choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    const contentState = inspectAssistantContent(firstChoice.message.content);
    if (!contentState.valid) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    if (firstChoice.message.refusal !== undefined && firstChoice.message.refusal !== null) {
        throw new ToolPlanningRejectedError('Hosted AI refused tool planning');
    }
    const finishReason = firstChoice.finish_reason;
    if (finishReason === 'length') {
        throw new ToolPlanningRejectedError('Hosted AI tool plan was truncated at the token limit');
    }
    const hasValidFinishReason = finishReason === 'tool_calls' || finishReason === 'stop';
    if (!hasValidFinishReason) {
        throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
    }
    if (!Array.isArray(firstChoice.message.tool_calls)) {
        if (contentState.hasContent) {
            throw new ToolPlanningRejectedError('Hosted AI returned a non-tool response instead of a tool-call batch');
        }
        if (finishReason === 'stop') {
            return [];
        }
        throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
    }
    if (finishReason === 'stop' && firstChoice.message.tool_calls.length > 0) {
        throw new ToolPlanningRejectedError('Hosted AI returned an inconsistent tool-call batch');
    }
    if (contentState.hasContent && firstChoice.message.tool_calls.length === 0) {
        throw new ToolPlanningRejectedError('Hosted AI returned a non-tool response instead of a tool-call batch');
    }

    const results: ToolCallResult[] = [];
    for (const rawCall of firstChoice.message.tool_calls) {
        if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-call batch');
        }
        const name = rawCall.function.name;
        const arguments_ = parseToolCallArguments(rawCall.function.arguments);
        const id = rawCall.id;
        if (
            typeof name !== 'string' ||
            name.length === 0 ||
            !arguments_ ||
            (id !== undefined && (typeof id !== 'string' || id.length === 0))
        ) {
            throw new ToolPlanningRejectedError(rejectedBatchMessage(id));
        }
        results.push({
            ...(typeof id === 'string' ? { id } : {}),
            name: decodeWireName(name),
            arguments: arguments_,
        });
    }
    if (finishReason === 'tool_calls' && results.length === 0) {
        throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
    }
    return results;
}

export async function generateOpenAiCompatibleToolCalls({
    runtime,
    systemPrompt,
    userMessage,
    toolSchemas,
    maxOutputTokens,
    directive,
    signal,
}: GenerateOpenAiCompatibleToolCallsInput): Promise<HostedToolPlan> {
    const codec = buildWireToolNameCodec(toolSchemas);
    const wireToolSchemas = narrowToolSchemasForDirective(toolSchemas, directive);
    const body = JSON.stringify({
        model: runtime.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ],
        tools: wireToolSchemas.map((schema) => {
            const useStrictSchema = runtime.strict_tool_schemas === true;
            const wireSchema = useStrictSchema ? projectOpenAiStrictToolSchema(schema) : schema;
            return {
                ...wireSchema,
                function: {
                    ...wireSchema.function,
                    name: codec.encode(wireSchema.function.name),
                    // Chat Completions defines `strict` inside `function`, beside `name` and
                    // `parameters` — not as a sibling of `function` on the tool wrapper.
                    ...(useStrictSchema ? { strict: true } : {}),
                },
            };
        }),
        // This dialect declares no `parallel_tool_calls` capability, so a forced choice omits
        // it rather than sending a field the adapter's own capability contract disowns.
        tool_choice: directive.mode === 'required' ? 'required' : 'auto',
        n: 1,
        stream: false,
        max_tokens: maxOutputTokens,
    });
    const chunks: Uint8Array[] = [];
    const response = await requestHostedOpenAiProvider({
        runtime,
        body,
        signal: signal ?? new AbortController().signal,
        onBodyChunk: (chunk) => chunks.push(chunk),
    });
    if (response.status < 200 || response.status >= 300) {
        throw new HostedAiHttpStatusError(
            response.status,
            `Hosted AI tool request failed with status ${String(response.status)}`
        );
    }
    let payload: unknown;
    try {
        const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        const bytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
        if (hasErrorName(error, 'SyntaxError')) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
        }
        throw error;
    }
    // Read before any rejection below so a refusal or a malformed batch still attributes
    // whatever usage figure the provider reported for the turn that produced it.
    const usage = isRecord(payload) ? readUsage(payload) : null;
    let calls: ToolCallResult[];
    try {
        calls = parseToolCalls(payload, codec.decode);
    } catch (error) {
        throw isToolPlanningRejectedError(error) ? new ToolPlanningRejectedError(error.message, usage) : error;
    }
    return {
        providerRequestId: isRecord(payload) ? readProviderRequestId(payload.id) : null,
        calls,
        strictToolSchemas: runtime.strict_tool_schemas === true,
        usage,
    };
}

function hasErrorName(value: unknown, name: string): boolean {
    return isRecord(value) && value.name === name;
}

function readUsage(payload: Record<string, unknown>): HostedToolPlanUsage | null {
    if (!isRecord(payload.usage)) {
        return null;
    }
    const details = isRecord(payload.usage.prompt_tokens_details) ? payload.usage.prompt_tokens_details : null;
    return {
        inputTokens: readHostedTokenCount(payload.usage.prompt_tokens),
        outputTokens: readHostedTokenCount(payload.usage.completion_tokens),
        cacheReadInputTokens: readHostedTokenCount(details?.cached_tokens),
        // The chat-completions dialect reports no separate cache-write figure.
        cacheWriteInputTokens: null,
    };
}
