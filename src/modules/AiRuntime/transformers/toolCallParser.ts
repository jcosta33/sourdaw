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

import type { ToolCallResult } from './strictToolPlanningParser';

export { parseToolPlanningOutcome, type ToolCallResult, type ToolPlanningOutcome } from './strictToolPlanningParser';

const INVALID_TOOL_CALL_NAME = '<invalid>';

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
    const id = obj.id;
    if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
        return null;
    }
    return { ...(typeof id === 'string' ? { id } : {}), name, arguments: args };
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
