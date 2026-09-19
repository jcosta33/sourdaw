import { HostedAiHttpStatusError } from '../../../errors/HostedAiHttpStatusError';
import { isToolPlanningRejectedError, ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { type HostedTurnHistory } from '../../../models/HostedTurnHistory';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { type OpenAiCloudRuntime } from '../cloudSession';

import { buildReasoningExtension } from './buildReasoningExtension';
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

type GenerateOpenAiResponsesToolCallsInput = {
    runtime: OpenAiCloudRuntime;
    systemPrompt: string;
    userMessage: string;
    toolSchemas: readonly ToolSchema[];
    maxOutputTokens: number;
    directive: HostedToolChoiceDirective;
    /** The loop's earlier turns, replayed natively; empty on the first turn of a run. */
    history?: HostedTurnHistory;
    /** What the loop still allows, stated once at the end of the replayed conversation. */
    budgetNote?: string;
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

/**
 * The input items this turn replays: the first user message, then each earlier turn's own
 * output items in the order the response carried them — `reasoning` items included, which is
 * what lets the model continue from the thinking it already did — each followed by its
 * receipts as `function_call_output` items. A turn another provider answered has no items this
 * API accepts, so its calls are restated as `function_call` items instead.
 */
function buildTurnInput(input: {
    userMessage: string;
    history: HostedTurnHistory;
    budgetNote: string;
    encodeToolName: (name: string) => string;
}): unknown[] {
    const items: unknown[] = [{ role: 'user', content: input.userMessage }];
    for (const record of input.history) {
        if (record.provider === 'openai') {
            items.push(...record.assistantItems);
        } else {
            for (const call of record.calls) {
                items.push({
                    type: 'function_call',
                    call_id: call.id,
                    name: input.encodeToolName(call.name),
                    arguments: JSON.stringify(call.arguments),
                });
            }
        }
        for (const receipt of record.receipts) {
            items.push({ type: 'function_call_output', call_id: receipt.callId, output: JSON.stringify(receipt) });
        }
    }
    if (input.history.length > 0 && input.budgetNote.length > 0) {
        items.push({ role: 'user', content: input.budgetNote });
    }
    return items;
}

function hasErrorName(value: unknown, name: string): boolean {
    return isRecord(value) && value.name === name;
}

function buildToolChoiceExtension(
    directive: HostedToolChoiceDirective,
    narrowedSchemas: readonly ToolSchema[],
    codec: ReturnType<typeof buildWireToolNameCodec>
): Record<string, unknown> {
    if (directive.mode === 'required') {
        // `allowed_tools` restricts the choice set without capping the call count: the
        // workflow terminal shape is two calls in one turn (`selectWorkflowCapability`
        // beside `command.batch.propose`), so `parallel_tool_calls` stays true here too.
        // The allowed set is read from the narrowed schema list, not the raw directive
        // names, so a terminal name with no matching advertised schema cannot reach the wire.
        return {
            tool_choice: {
                type: 'allowed_tools',
                mode: 'required',
                tools: narrowedSchemas.map((schema) => ({
                    type: 'function',
                    name: codec.encode(schema.function.name),
                })),
            },
            parallel_tool_calls: true,
        };
    }
    return { tool_choice: 'auto', parallel_tool_calls: true };
}

function readUsage(payload: Record<string, unknown>): HostedToolPlanUsage | null {
    if (!isRecord(payload.usage)) {
        return null;
    }
    const details = isRecord(payload.usage.input_tokens_details) ? payload.usage.input_tokens_details : null;
    return {
        inputTokens: readHostedTokenCount(payload.usage.input_tokens),
        outputTokens: readHostedTokenCount(payload.usage.output_tokens),
        cacheReadInputTokens: readHostedTokenCount(details?.cached_tokens),
        // The Responses API reports no separate cache-write figure.
        cacheWriteInputTokens: null,
    };
}

export async function generateOpenAiResponsesToolCalls({
    runtime,
    systemPrompt,
    userMessage,
    toolSchemas,
    maxOutputTokens,
    directive,
    history,
    budgetNote,
    signal,
}: GenerateOpenAiResponsesToolCallsInput): Promise<HostedToolPlan> {
    const codec = buildWireToolNameCodec(toolSchemas);
    // `allowed_tools` restricts the model's choice without dropping any tool from the
    // advertised set below, so only the narrowed name list feeds the tool-choice
    // extension; the shared empty-set validation still applies here.
    const narrowedSchemas = narrowToolSchemasForDirective(toolSchemas, directive);
    const body = JSON.stringify({
        model: runtime.model,
        instructions: systemPrompt,
        input: buildTurnInput({
            userMessage,
            history: history ?? [],
            budgetNote: budgetNote ?? '',
            encodeToolName: codec.encode,
        }),
        tools: toolSchemas.map((schema) => {
            const strictSchema = projectOpenAiStrictToolSchema(schema);
            return {
                type: 'function',
                name: codec.encode(strictSchema.function.name),
                description: strictSchema.function.description,
                parameters: strictSchema.function.parameters,
                strict: true,
            };
        }),
        ...buildToolChoiceExtension(directive, narrowedSchemas, codec),
        max_output_tokens: maxOutputTokens,
        stream: false,
        // The data policy disclosed to users is request-scoped processing, so no
        // request may be retained on the provider side.
        store: false,
        ...buildReasoningExtension(runtime),
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
        calls = parseToolPlan(payload, codec.decode);
    } catch (error) {
        throw isToolPlanningRejectedError(error) ? new ToolPlanningRejectedError(error.message, usage) : error;
    }
    return {
        providerRequestId: isRecord(payload) ? readProviderRequestId(payload.id) : null,
        calls,
        // Every output item, so a later turn hands this turn's reasoning items back unchanged;
        // only `function_call` and `message` items decided the plan above.
        assistantItems: isRecord(payload) && Array.isArray(payload.output) ? payload.output : [],
        strictToolSchemas: true,
        usage,
    };
}
