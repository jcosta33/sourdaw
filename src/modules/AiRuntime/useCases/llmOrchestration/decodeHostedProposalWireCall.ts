import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { parseUniqueKeyJson } from '../../transformers/parseUniqueKeyJson';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { COMMAND_BATCH_PROPOSAL_TOOL_NAME } from '../agentToolCatalog';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeItem(value: unknown): Record<string, unknown> | null {
    if (!isRecord(value) || Object.hasOwn(value, 'arguments') || typeof value.argumentsJson !== 'string') {
        return null;
    }
    const argumentsValue = parseUniqueKeyJson(value.argumentsJson);
    if (!isRecord(argumentsValue) || Object.getPrototypeOf(argumentsValue) !== Object.prototype) {
        return null;
    }
    const rest = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'argumentsJson'));
    return { ...rest, arguments: argumentsValue };
}

export function decodeHostedProposalWireCall(call: ToolCallResult, canonicalSchema: ToolSchema): ToolCallResult | null {
    if (call.name !== COMMAND_BATCH_PROPOSAL_TOOL_NAME) {
        return call;
    }
    const wireArguments = call.arguments;
    const hasCommands = Array.isArray(wireArguments.commands);
    const list = isRecord(wireArguments.list) ? wireArguments.list : null;
    const hasList = list !== null && Array.isArray(list.items);
    if (hasCommands === hasList) {
        return null;
    }
    let decoded: Record<string, unknown>;
    if (Array.isArray(wireArguments.commands)) {
        const items = wireArguments.commands.map(decodeItem);
        if (items.some((item) => item === null)) {
            return null;
        }
        decoded = { ...wireArguments, commands: items };
    } else if (list !== null && Array.isArray(list.items)) {
        const items = list.items.map(decodeItem);
        if (items.some((item) => item === null)) {
            return null;
        }
        decoded = { ...wireArguments, list: { ...list, items } };
    } else {
        return null;
    }
    if (!matchesJsonSchema(decoded, canonicalSchema.function.parameters)) {
        return null;
    }
    return { ...call, arguments: decoded };
}
