/**
 * Transformer: Parse LLM tool call responses.
 * Handles multiple model output formats:
 * - Hermes XML:     <tool_call>{"name":"...","arguments":{...}}</tool_call>
 * - JSON object:    {"actions":[{"name":"...","arguments":{...}}]}
 * - JSON array:     [{"name":"...","arguments":{...}}]
 * - JSONL:          {"name":"...","arguments":{...}}\n{"name":"...","arguments":{...}}
 * - Llama format:   <function>{"name":"...","parameters":{...}}</function>
 */

import { logger } from '#/infra/logger/appLogger';

export type ToolCallResult = {
    name: string;
    arguments: Record<string, unknown>;
};

export type ToolPlanningOutcome =
    { status: 'complete'; toolCalls: ToolCallResult[] } | { status: 'rejected'; reason: string };

const INVALID_TOOL_CALL_NAME = '<invalid>';

export function parseToolPlanningOutcome(content: string): ToolPlanningOutcome {
    if (isExplicitEmptyToolCallBatch(content)) {
        return { status: 'complete', toolCalls: [] };
    }

    const toolCalls = parseToolCallXml(content);
    if (toolCalls.some((call) => call.name === INVALID_TOOL_CALL_NAME)) {
        return { status: 'rejected', reason: 'Model returned a malformed tool-call batch.' };
    }
    if (toolCalls.length > 0) {
        return { status: 'complete', toolCalls };
    }

    if (content.trim().length === 0) {
        return { status: 'rejected', reason: 'Model returned an empty tool-planning response.' };
    }
    if (looksLikeToolCallSyntax(content)) {
        return { status: 'rejected', reason: 'Model returned a malformed tool-call batch.' };
    }
    return {
        status: 'rejected',
        reason: 'Model returned a non-tool response instead of a complete tool-call batch.',
    };
}

function isExplicitEmptyToolCallBatch(content: string): boolean {
    const candidate = getJsonCandidate(content);
    try {
        const parsed = JSON.parse(candidate) as unknown;
        if (Array.isArray(parsed)) {
            return parsed.length === 0;
        }
        if (!isObject(parsed)) {
            return false;
        }
        if (Array.isArray(parsed.actions)) {
            return parsed.actions.length === 0;
        }
        if (Array.isArray(parsed.tool_calls)) {
            return parsed.tool_calls.length === 0;
        }
        return false;
    } catch {
        return false;
    }
}

function looksLikeToolCallSyntax(content: string): boolean {
    const candidate = getJsonCandidate(content);
    return candidate.startsWith('{') || candidate.startsWith('[') || /<\/?(?:tool_call|function)>/.test(content);
}

function getJsonCandidate(content: string): string {
    const trimmed = content.trim();
    const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
    return (fencedJson ?? trimmed).trim();
}

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

    // 2. Fall back to XML-based parsing (Hermes / Llama format). Every
    // identified tag is preserved so malformed calls cannot disappear before
    // all-or-nothing bridge validation and batch-size enforcement.
    const taggedMatches = [...content.matchAll(/<(tool_call|function)>([\s\S]*?)<\/\1>/g)];
    const taggedResults = taggedMatches.map(
        (match) => tryParseToolCallJson(String(match[2]).trim()) ?? invalidToolCall()
    );
    const openingTagCount = [...content.matchAll(/<(?:tool_call|function)>/g)].length;
    const closingTagCount = [...content.matchAll(/<\/(?:tool_call|function)>/g)].length;
    const identifiedTagCount = Math.max(openingTagCount, closingTagCount);
    if (identifiedTagCount > 0) {
        const unmatchedTagCount = identifiedTagCount - taggedMatches.length;
        return [...taggedResults, ...Array.from({ length: unmatchedTagCount }, invalidToolCall)];
    }

    // 3. JSONL fallback. Preserve every object-shaped candidate line for the
    // same reason as tagged calls.
    return content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('{'))
        .map((line) => tryParseToolCallJson(line) ?? invalidToolCall());
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
    const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
    const candidate = (fencedJson ?? trimmed).trim();

    if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
        return [];
    }

    try {
        const parsed = JSON.parse(candidate) as unknown;

        // {"actions":[...]} wrapper
        if (isObject(parsed) && Array.isArray(parsed.actions)) {
            return parsed.actions.map(coerceArrayToolCall);
        }

        // {"tool_calls":[...]} wrapper
        if (isObject(parsed) && Array.isArray(parsed.tool_calls)) {
            return parsed.tool_calls.map(coerceArrayToolCall);
        }

        // Top-level array
        if (Array.isArray(parsed)) {
            return parsed.map(coerceArrayToolCall);
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

function coerceArrayToolCall(raw: unknown): ToolCallResult {
    return coerceToolCall(raw) ?? invalidToolCall();
}

function invalidToolCall(): ToolCallResult {
    return { name: INVALID_TOOL_CALL_NAME, arguments: {} };
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
