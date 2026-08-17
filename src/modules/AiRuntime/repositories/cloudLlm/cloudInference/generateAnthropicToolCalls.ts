import { ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { type AnthropicCloudRuntime } from '../cloudSession';

import { requestAnthropicProvider } from './requestAnthropicProvider';

const MAX_RESPONSE_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function generateAnthropicToolCalls(input: {
    runtime: AnthropicCloudRuntime;
    systemPrompt: string;
    userMessage: string;
    toolSchemas: readonly ToolSchema[];
    signal: AbortSignal;
}): Promise<ToolCallResult[]> {
    const chunks: Uint8Array[] = [];
    let responseBytes = 0;
    const body = JSON.stringify({
        model: input.runtime.model,
        max_tokens: 2048,
        system: input.systemPrompt,
        tools: input.toolSchemas.map((schema) => ({
            name: schema.function.name,
            description: schema.function.description,
            input_schema: schema.function.parameters,
        })),
        messages: [{ role: 'user', content: input.userMessage }],
    });
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
        throw new Error(`Hosted AI tool-planning request failed with status ${String(response.status)}`);
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
    if (!isRecord(payload) || !Array.isArray(payload.content)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }

    const results: ToolCallResult[] = [];
    let hasNonToolText = false;
    for (const block of payload.content) {
        if (!isRecord(block)) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
        }
        if (block.type === 'text') {
            if (typeof block.text !== 'string') {
                throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
            }
            hasNonToolText ||= block.text.trim().length > 0;
            continue;
        }
        if (block.type !== 'tool_use' || typeof block.name !== 'string' || !isRecord(block.input)) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-call batch');
        }
        results.push({
            ...(typeof block.id === 'string' && block.id.length > 0 ? { id: block.id } : {}),
            name: block.name,
            arguments: block.input,
        });
    }
    const hasValidToolStop = payload.stop_reason === 'tool_use' && results.length > 0;
    const hasValidEmptyStop = payload.stop_reason === 'end_turn' && results.length === 0 && !hasNonToolText;
    if (!hasValidToolStop && !hasValidEmptyStop) {
        throw new ToolPlanningRejectedError(
            hasNonToolText
                ? 'Hosted AI returned a non-tool response instead of a tool-call batch'
                : 'Hosted AI returned an incomplete tool-call batch'
        );
    }
    return results;
}
