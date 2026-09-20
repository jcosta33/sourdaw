import { HostedAiHttpStatusError } from '../../../errors/HostedAiHttpStatusError';
import { ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { type HostedTurnHistory, type HostedTurnRecord } from '../../../models/HostedTurnHistory';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { type AnthropicCloudRuntime } from '../cloudSession';

import { anthropicModelRejectsForcedToolChoice } from './anthropicModelFamilies';
import { buildAnthropicThinkingBudget } from './buildAnthropicThinkingBudget';
import { buildWireToolNameCodec } from './buildWireToolNameCodec';
import {
    type HostedToolChoiceDirective,
    type HostedToolPlan,
    type HostedToolPlanUsage,
    readHostedTokenCount,
} from './hostedToolPlan';
import { narrowToolSchemasForDirective } from './narrowToolSchemasForDirective';
import { projectAnthropicStrictToolSchema } from './projectAnthropicStrictToolSchema';
import { readProviderRequestId } from './readProviderRequestId';
import { requestAnthropicProvider } from './requestAnthropicProvider';

const MAX_RESPONSE_BYTES = 1024 * 1024;

const CACHE_CONTROL = { type: 'ephemeral' } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The thinking tokens a reply bills, which only a response carrying the detail object reports. */
function readThinkingTokens(usage: Record<string, unknown>): number | null {
    if (!isRecord(usage.output_tokens_details)) {
        return null;
    }
    return readHostedTokenCount(usage.output_tokens_details.thinking_tokens);
}

function readUsage(payload: Record<string, unknown>): HostedToolPlanUsage | null {
    if (!isRecord(payload.usage)) {
        return null;
    }
    return {
        inputTokens: readHostedTokenCount(payload.usage.input_tokens),
        outputTokens: readHostedTokenCount(payload.usage.output_tokens),
        cacheReadInputTokens: readHostedTokenCount(payload.usage.cache_read_input_tokens),
        cacheWriteInputTokens: readHostedTokenCount(payload.usage.cache_creation_input_tokens),
        reasoningTokens: readThinkingTokens(payload.usage),
    };
}

/**
 * The forced tool choice a `required` directive asks for, where the model accepts one.
 * Extended thinking and the fable/mythos families both refuse a forced choice, and a
 * refused request returns no plan at all; the narrowed tool set carries the directive
 * for them instead.
 */
function buildToolChoiceExtension(input: {
    directive: HostedToolChoiceDirective;
    model: string;
    thinking: AnthropicCloudRuntime['thinking'];
}): Record<string, unknown> {
    if (input.directive.mode !== 'required') {
        return {};
    }
    if (input.thinking?.type === 'enabled' || anthropicModelRejectsForcedToolChoice(input.model)) {
        return {};
    }
    // No `disable_parallel_tool_use`: the workflow terminal shape is two calls in one
    // turn (`selectWorkflowCapability` beside `command.batch.propose`), so capping the
    // forced turn at one call would strand the batch call out of its workflow scope.
    // `maxCallsPerTurn` already bounds how many calls one turn may contain.
    return { tool_choice: { type: 'any' } };
}

/**
 * The conversation this turn replays: the first user message, then each earlier turn as the
 * assistant blocks the provider itself produced (or, for a turn another provider answered and
 * for one whose calls it never named, the tool-use blocks those calls amount to), each answered
 * by its receipts as `tool_result` blocks. The remaining-budget note closes the last user block,
 * where alternating roles put it.
 */
function buildAssistantContent(record: HostedTurnRecord, encodeToolName: (name: string) => string): unknown {
    if (record.provider === 'anthropic' && record.assistantItems !== null) {
        return record.assistantItems;
    }
    return record.calls.map((call) => ({
        type: 'tool_use',
        id: call.id,
        name: encodeToolName(call.name),
        input: call.arguments,
    }));
}

function buildTurnMessages(input: {
    userMessage: string;
    history: HostedTurnHistory;
    budgetNote: string;
    encodeToolName: (name: string) => string;
}): unknown[] {
    const messages: unknown[] = [{ role: 'user', content: input.userMessage }];
    for (const [index, record] of input.history.entries()) {
        messages.push({
            role: 'assistant',
            content: buildAssistantContent(record, input.encodeToolName),
        });
        const content: unknown[] = record.receipts.map((receipt) => ({
            type: 'tool_result',
            tool_use_id: receipt.callId,
            content: JSON.stringify(receipt),
        }));
        const isLastRecord = index === input.history.length - 1;
        if (isLastRecord && input.budgetNote.length > 0) {
            content.push({ type: 'text', text: input.budgetNote });
        }
        messages.push({ role: 'user', content });
    }
    return messages;
}

export async function generateAnthropicToolCalls(input: {
    runtime: AnthropicCloudRuntime;
    systemPrompt: string;
    userMessage: string;
    toolSchemas: readonly ToolSchema[];
    // The admitted provider request (llmOrchestration/inference.ts) is the single source of
    // truth for this budget — see models/HostedToolPlanLimits.ts. The wire request must use
    // exactly what was admitted, not a constant of its own, or the two can silently drift.
    maxOutputTokens: number;
    directive: HostedToolChoiceDirective;
    /** The loop's earlier turns, replayed natively; empty on the first turn of a run. */
    history?: HostedTurnHistory;
    /** What the loop still allows, stated once at the end of the replayed conversation. */
    budgetNote?: string;
    signal: AbortSignal;
}): Promise<HostedToolPlan> {
    const chunks: Uint8Array[] = [];
    let responseBytes = 0;
    const codec = buildWireToolNameCodec(input.toolSchemas);
    const wireToolSchemas = narrowToolSchemasForDirective(input.toolSchemas, input.directive);
    const lastToolIndex = wireToolSchemas.length - 1;
    // A tool-planning turn reads none of the thinking it asks for: the plan is the tool
    // calls, and any thinking block the response carries is skipped by the parser below.
    const outputBudget = buildAnthropicThinkingBudget({
        thinking: input.runtime.thinking,
        display: 'omitted',
        maxOutputTokens: input.maxOutputTokens,
    });
    const requestPayload: Record<string, unknown> = {
        model: input.runtime.model,
        max_tokens: outputBudget.maxTokens,
        system: [{ type: 'text', text: input.systemPrompt, cache_control: CACHE_CONTROL }],
        tools: wireToolSchemas.map((schema, index) => {
            const strictSchema = projectAnthropicStrictToolSchema(schema);
            return {
                name: codec.encode(strictSchema.function.name),
                description: strictSchema.function.description,
                input_schema: strictSchema.function.parameters,
                strict: true,
                ...(index === lastToolIndex ? { cache_control: CACHE_CONTROL } : {}),
            };
        }),
        messages: buildTurnMessages({
            userMessage: input.userMessage,
            history: input.history ?? [],
            budgetNote: input.budgetNote ?? '',
            encodeToolName: codec.encode,
        }),
        ...buildToolChoiceExtension({
            directive: input.directive,
            model: input.runtime.model,
            thinking: input.runtime.thinking,
        }),
    };
    if (outputBudget.thinking !== null) {
        requestPayload.thinking = outputBudget.thinking;
    }
    const body = JSON.stringify(requestPayload);
    const response = await requestAnthropicProvider({
        sessionId: input.runtime.session_id,
        body,
        signal: input.signal,
        onBodyChunk: (chunk) => {
            responseBytes += chunk.byteLength;
            if (responseBytes > MAX_RESPONSE_BYTES) {
                throw new Error('Hosted AI tool-planning response exceeded its size limit');
            }
            chunks.push(chunk);
        },
    });
    if (response.status < 200 || response.status >= 300) {
        throw new HostedAiHttpStatusError(
            response.status,
            `Hosted AI tool-planning request failed with status ${String(response.status)}`
        );
    }
    if (response.contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning content type');
    }
    const bytes = new Uint8Array(responseBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    let payload: unknown;
    try {
        payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        throw new ToolPlanningRejectedError('Hosted AI returned invalid tool-planning JSON');
    }
    // Read before any rejection below so a refusal or a malformed batch still attributes
    // whatever usage figure the provider reported for the turn that produced it.
    const usage = isRecord(payload) ? readUsage(payload) : null;
    if (!isRecord(payload) || !Array.isArray(payload.content)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response', usage);
    }

    const results: ToolCallResult[] = [];
    let hasNonToolText = false;
    for (const block of payload.content) {
        if (!isRecord(block)) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response', usage);
        }
        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            // Extended thinking precedes the calls it produced. It is not an answer in
            // prose, so it never counts as non-tool text; `assistantItems` carries it back
            // unmodified on the next turn, which the provider requires.
            continue;
        }
        if (block.type === 'text') {
            if (typeof block.text !== 'string') {
                throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response', usage);
            }
            hasNonToolText ||= block.text.trim().length > 0;
            continue;
        }
        if (block.type !== 'tool_use' || typeof block.name !== 'string' || !isRecord(block.input)) {
            // A rejected batch names the offending call so a provider-side record can
            // be found for it; the arguments themselves stay out of the message.
            const callId = readProviderRequestId(block.id);
            throw new ToolPlanningRejectedError(
                callId === null
                    ? 'Hosted AI returned an invalid tool-call batch'
                    : `Hosted AI returned an invalid tool-call batch for call ${callId}`,
                usage
            );
        }
        results.push({
            ...(typeof block.id === 'string' && block.id.length > 0 ? { id: block.id } : {}),
            name: codec.decode(block.name),
            arguments: block.input,
        });
    }
    if (payload.stop_reason === 'max_tokens') {
        throw new ToolPlanningRejectedError('Hosted AI tool plan was truncated at the token limit', usage);
    }
    const hasValidToolStop = payload.stop_reason === 'tool_use' && results.length > 0;
    const hasValidEmptyStop = payload.stop_reason === 'end_turn' && results.length === 0 && !hasNonToolText;
    if (!hasValidToolStop && !hasValidEmptyStop) {
        throw new ToolPlanningRejectedError(
            hasNonToolText
                ? 'Hosted AI returned a non-tool response instead of a tool-call batch'
                : 'Hosted AI returned an incomplete tool-call batch',
            usage
        );
    }
    return {
        providerRequestId: readProviderRequestId(payload.id),
        calls: results,
        assistantItems: payload.content,
        strictToolSchemas: true,
        usage,
    };
}
