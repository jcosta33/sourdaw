/**
 * Transformer: Parse LLM tool call responses.
 * Handles multiple model output formats (XML, JSONL, etc.).
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
 *
 * Handles all observed model output formats:
 * 1. Proper XML:    <tool_call>{"name":"...","arguments":{...}}</tool_call>
 * 2. Open-only:     <tool_call>\n{...}\n<tool_call>\n{...}
 * 3. JSONL in one:  <tool_call>\n{...}\n{...}\n{...}\n</tool_call>
 * 4. Llama format:  <function>{"name":"...","parameters":{...}}</function>
 */
export function parseToolCallXml(content: string): ToolCallResult[] {
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

function tryParseToolCallJson(jsonStr: string | undefined): ToolCallResult | null {
    if (!jsonStr) {
        return null;
    }
    try {
        const parsed = JSON.parse(jsonStr) as {
            name?: string;
            arguments?: Record<string, unknown>;
            parameters?: Record<string, unknown>;
        };
        if (!parsed.name) {
            return null;
        }
        return {
            name: parsed.name,
            arguments: parsed.arguments ?? parsed.parameters ?? {},
        };
    } catch {
        logger.warn(`[AI Engine] Failed to parse tool call JSON: ${jsonStr.slice(0, 100)}`);
        return null;
    }
}
