import { HostedAiHttpStatusError } from '../../../errors/HostedAiHttpStatusError';
import { ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { type OpenAiCloudRuntime } from '../cloudSession';

import { buildWireToolNameCodec } from './buildWireToolNameCodec';
import { type HostedToolPlan } from './hostedToolPlan';
import { isGpt56FamilyModel } from './openAiModelFamilies';
import { parseToolCallArguments } from './parseToolCallArguments';
import { readProviderRequestId } from './readProviderRequestId';
import { rejectedBatchMessage } from './rejectedBatchMessage';
import { requestHostedOpenAiProvider } from './requestOpenAiProvider';

type GenerateOpenAiResponsesToolCallsInput = {
    runtime: OpenAiCloudRuntime;
    systemPrompt: string;
    userMessage: string;
    toolSchemas: readonly ToolSchema[];
    maxOutputTokens: number;
    signal?: AbortSignal;
};

type MessageContentState = { refused: boolean; hasContent: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inspectMessageContent(value: unknown): MessageContentState {
    if (!Array.isArray(value)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    let refused = false;
    let hasContent = false;
    for (const part of value) {
        if (!isRecord(part)) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
        }
        // Only the fact that the provider declined leaves this parser; the refusal
        // text itself is provider body content.
        if (part.type === 'refusal') {
            refused = true;
            continue;
        }
        if (part.type !== 'output_text' || typeof part.text !== 'string') {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
        }
        if (part.text.trim().length > 0) {
            hasContent = true;
        }
    }
    return { refused, hasContent };
}

function assertPlanCompleted(payload: Record<string, unknown>): void {
    if (payload.status !== 'incomplete' && payload.status !== 'failed') {
        return;
    }
    const details = isRecord(payload.incomplete_details) ? payload.incomplete_details : null;
    if (details?.reason === 'max_output_tokens') {
        throw new ToolPlanningRejectedError('Hosted AI tool plan was truncated at the token limit');
    }
    throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
}

function readFunctionCall(item: Record<string, unknown>, decodeWireName: (wireName: string) => string): ToolCallResult {
    const callId = item.call_id;
    const name = item.name;
    const arguments_ = parseToolCallArguments(item.arguments);
    if (
        typeof name !== 'string' ||
        name.length === 0 ||
        !arguments_ ||
        (callId !== undefined && (typeof callId !== 'string' || callId.length === 0))
    ) {
        throw new ToolPlanningRejectedError(rejectedBatchMessage(callId));
    }
    return {
        ...(typeof callId === 'string' ? { id: callId } : {}),
        name: decodeWireName(name),
        arguments: arguments_,
    };
}

function parseToolPlan(payload: unknown, decodeWireName: (wireName: string) => string): ToolCallResult[] {
    if (!isRecord(payload) || !Array.isArray(payload.output)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    assertPlanCompleted(payload);

    const results: ToolCallResult[] = [];
    let refused = false;
    let hasContent = false;
    for (const item of payload.output) {
        if (!isRecord(item) || typeof item.type !== 'string') {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
        }
        if (item.type === 'function_call') {
            results.push(readFunctionCall(item, decodeWireName));
            continue;
        }
        // Items the response carries for its own reasoning or built-in tools hold no
        // plan; only assistant messages and function calls decide this outcome.
        if (item.type === 'message') {
            const state = inspectMessageContent(item.content);
            refused ||= state.refused;
            hasContent ||= state.hasContent;
        }
    }
    if (refused) {
        throw new ToolPlanningRejectedError('Hosted AI refused tool planning');
    }
    if (results.length === 0 && hasContent) {
        throw new ToolPlanningRejectedError('Hosted AI returned a non-tool response instead of a tool-call batch');
    }
    return results;
}

function hasErrorName(value: unknown, name: string): boolean {
    return isRecord(value) && value.name === name;
}

export async function generateOpenAiResponsesToolCalls({
    runtime,
    systemPrompt,
    userMessage,
    toolSchemas,
    maxOutputTokens,
    signal,
}: GenerateOpenAiResponsesToolCallsInput): Promise<HostedToolPlan> {
    const codec = buildWireToolNameCodec(toolSchemas);
    const body = JSON.stringify({
        model: runtime.model,
        instructions: systemPrompt,
        input: [{ role: 'user', content: userMessage }],
        tools: toolSchemas.map((schema) => ({
            type: 'function',
            name: codec.encode(schema.function.name),
            description: schema.function.description,
            parameters: schema.function.parameters,
            strict: false,
        })),
        tool_choice: 'auto',
        parallel_tool_calls: true,
        max_output_tokens: maxOutputTokens,
        stream: false,
        // The data policy disclosed to users is request-scoped processing, so no
        // request may be retained on the provider side.
        store: false,
        ...(isGpt56FamilyModel(runtime.model) ? { reasoning: { effort: 'none' } } : {}),
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
    return {
        providerRequestId: isRecord(payload) ? readProviderRequestId(payload.id) : null,
        calls: parseToolPlan(payload, codec.decode),
    };
}
