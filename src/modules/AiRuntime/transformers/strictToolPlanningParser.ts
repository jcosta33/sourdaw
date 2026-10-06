import { type AgentPlanProposal } from '../models/AgentRun';
import { type HostedProviderTurn } from '../models/HostedTurnHistory';
import { type ToolCallResult } from '../models/ToolCallResult';

import { extractAgentPlanProposal } from './normalizeAgentPlanProposal';
import { parseUniqueKeyJson } from './parseUniqueKeyJson';

// Re-exported so every existing import keeps resolving `ToolCallResult` from this module;
// the type itself lives in `models/` because `models/HostedTurnHistory.ts` carries it too,
// and a model may not import a transformer.
export { type ToolCallResult };

export type ToolPlanningOutcome =
    | {
          status: 'complete';
          toolCalls: ToolCallResult[];
          proposal: AgentPlanProposal | null;
          /** The provider's own record of the turn that produced these calls; hosted backends only. */
          providerTurn?: HostedProviderTurn;
      }
    | { status: 'rejected'; reason: string };

function completeOutcome(toolCalls: ToolCallResult[]): ToolPlanningOutcome {
    return { status: 'complete', toolCalls, proposal: extractAgentPlanProposal(toolCalls) };
}
const MALFORMED_REASON = 'Model returned a malformed tool-call batch.';
const EMPTY_REASON = 'Model returned an empty tool-planning response.';
const NON_TOOL_REASON = 'Model returned a non-tool response instead of a complete tool-call batch.';
export function parseToolPlanningOutcome(content: string): ToolPlanningOutcome {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        return { status: 'rejected', reason: EMPTY_REASON };
    }
    let toolCalls: ToolCallResult[] | null = null;
    if (trimmed.startsWith('```')) {
        const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/)?.[1];
        toolCalls = fencedJson === undefined ? null : parseJsonBatch(fencedJson);
    } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        toolCalls = parseJsonBatch(trimmed);
        if (toolCalls === null && trimmed.includes('\n')) {
            const lines = trimmed.split('\n').filter((line) => line.trim().length > 0);
            toolCalls = lines.length > 1 ? parseCalls(lines.map(parseUniqueKeyJson)) : null;
        }
    } else if (/<\/?(?:tool_call|function)>/.test(trimmed)) {
        toolCalls = parseXmlSequence(trimmed);
    }
    if (toolCalls !== null) {
        return completeOutcome(toolCalls);
    }
    const hasToolSyntax =
        /```|<\/?(?:tool_call|function)>|"(?:name|actions|tool_calls|arguments|parameters)"|\n\s*[[{]/.test(trimmed);
    return { status: 'rejected', reason: hasToolSyntax ? MALFORMED_REASON : NON_TOOL_REASON };
}
function parseJsonBatch(content: string): ToolCallResult[] | null {
    const parsed = parseUniqueKeyJson(content);
    if (Array.isArray(parsed)) {
        return parseCalls(parsed);
    }
    if (!isRecord(parsed)) {
        return null;
    }
    const keys = Object.keys(parsed);
    const wrapperKey = keys[0];
    if (keys.length === 1 && (wrapperKey === 'actions' || wrapperKey === 'tool_calls')) {
        const wrappedCalls = parsed[wrapperKey];
        return Array.isArray(wrappedCalls) ? parseCalls(wrappedCalls) : null;
    }
    const toolCall = parseCall(parsed);
    return toolCall === null ? null : [toolCall];
}
function parseXmlSequence(content: string): ToolCallResult[] | null {
    const tagPattern = /<(tool_call|function)>\s*([\s\S]*?)\s*<\/\1>/g;
    const toolCalls: ToolCallResult[] = [];
    let cursor = 0;
    for (const match of content.matchAll(tagPattern)) {
        if (content.slice(cursor, match.index).trim().length > 0) {
            return null;
        }
        const toolCall = parseCall(parseUniqueKeyJson(match[2]));
        if (toolCall === null) {
            return null;
        }
        toolCalls.push(toolCall);
        cursor = match.index + match[0].length;
    }
    const hasResidue = content.slice(cursor).trim().length > 0;
    return toolCalls.length > 0 && !hasResidue ? toolCalls : null;
}
function parseCalls(values: unknown[]): ToolCallResult[] | null {
    const toolCalls = values.map(parseCall);
    return toolCalls.every((call) => call !== null) ? toolCalls : null;
}
function parseCall(value: unknown): ToolCallResult | null {
    if (!isRecord(value)) {
        return null;
    }
    const hasUnknownKey = Object.keys(value).some(
        (key) => key !== 'id' && key !== 'name' && key !== 'arguments' && key !== 'parameters'
    );
    const argumentKeys = ['arguments', 'parameters'].filter((key) => Object.hasOwn(value, key));
    if (
        hasUnknownKey ||
        !Object.hasOwn(value, 'name') ||
        typeof value.name !== 'string' ||
        value.name.length === 0 ||
        argumentKeys.length > 1 ||
        (Object.hasOwn(value, 'id') && (typeof value.id !== 'string' || value.id.length === 0))
    ) {
        return null;
    }
    const argumentKey = argumentKeys[0];
    const argumentsValue = argumentKey === undefined ? {} : value[argumentKey];
    return isRecord(argumentsValue)
        ? {
              ...(typeof value.id === 'string' ? { id: value.id } : {}),
              name: value.name,
              arguments: argumentsValue,
          }
        : null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
