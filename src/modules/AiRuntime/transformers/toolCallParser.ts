/**
 * Transformer: Parse LLM tool call responses.
 * Handles multiple model output formats:
 * - Hermes XML:     <tool_call>{"name":"...","arguments":{...}}</tool_call>
 * - JSON object:    {"actions":[{"name":"...","arguments":{...}}]}
 * - JSON array:     [{"name":"...","arguments":{...}}]
 * - JSONL:          {"name":"...","arguments":{...}}\n{"name":"...","arguments":{...}}
 * - Llama format:   <function>{"name":"...","parameters":{...}}</function>
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

const logger = Container.getInstance().get(Logger);

export type ToolCallResult = {
    name: string;
    arguments: Record<string, unknown>;
};

/**
 * Parse tool calls from model response content.
 * Handles all observed model output formats (see module docstring).
 */
export function parseToolCallXml(content: string): ToolCallResult[] {
    // 1. Try JSON-mode formats first (faster, no XML splitting)
    const jsonResults = tryParseJsonMode(content);
    if (jsonResults.length > 0) {
        return jsonResults;
    }

    // 2. Fall back to XML-based parsing (Hermes / Llama format)
    const results: ToolCallResult[] = [];
    const segments = content.split(/<\/?tool_call>|<\/?function>/);

    for (const segment of segments) {
        const lines = segment.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('{')) {
                continue;
            }
            const parsed = tryParseToolCallJson(trimmed);
            if (parsed) {
                results.push(parsed);
            }
        }
    }

    return results;
}

/**
 * Try to parse JSON-mode responses:
 * - {"actions":[...]} wrapper
 * - Top-level JSON array [...]
 * - Single tool call object {"name":"..."}
 */
function tryParseJsonMode(content: string): ToolCallResult[] {
    const trimmed = content.trim();

    // Try to extract JSON from potential markdown fencing
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, trimmed];
    const candidate = (jsonMatch[1] ?? trimmed).trim();

    if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
        return [];
    }

    try {
        const parsed = JSON.parse(candidate) as unknown;

        // {"actions":[...]} wrapper
        if (isObject(parsed) && Array.isArray(parsed.actions)) {
            return (parsed.actions as unknown[]).map(coerceToolCall).filter((r): r is ToolCallResult => r !== null);
        }

        // {"tool_calls":[...]} wrapper
        if (isObject(parsed) && Array.isArray(parsed.tool_calls)) {
            return (parsed.tool_calls as unknown[]).map(coerceToolCall).filter((r): r is ToolCallResult => r !== null);
        }

        // Top-level array
        if (Array.isArray(parsed)) {
            return (parsed as unknown[]).map(coerceToolCall).filter((r): r is ToolCallResult => r !== null);
        }

        // Single tool call object
        const single = coerceToolCall(parsed);
        if (single) {
            return [single];
        }
    } catch {
        // Not valid JSON, fall through to XML parsing
    }

    return [];
}

function isObject(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function coerceToolCall(raw: unknown): ToolCallResult | null {
    if (!isObject(raw)) {
        return null;
    }
    const obj = raw;
    const name = obj.name;
    if (typeof name !== 'string' || name.length === 0) {
        return null;
    }
    const args = (obj.arguments ?? obj.parameters ?? {}) as Record<string, unknown>;
    return { name, arguments: args };
}

function tryParseToolCallJson(jsonStr: string | undefined): ToolCallResult | null {
    if (!jsonStr) {
        return null;
    }
    try {
        const parsed = JSON.parse(jsonStr) as unknown;
        return coerceToolCall(parsed);
    } catch {
        logger.warn(`[AI Engine] Failed to parse tool call JSON: ${jsonStr.slice(0, 100)}`);
        return null;
    }
}
