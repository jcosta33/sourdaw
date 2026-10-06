import { type ToolCallResult } from '../../models/ToolCallResult';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { parseUniqueKeyJson } from '../../transformers/parseUniqueKeyJson';
import { matchesJsonSchema } from '../../validators/matchesJsonSchema';
import { ANALYSIS_MEASURE_TOOL_NAME, COMMAND_BATCH_PROPOSAL_TOOL_NAME } from '../agentToolCatalog';

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

function decodeItems(items: readonly unknown[]): Record<string, unknown>[] | null {
    const decoded = items.map(decodeItem);
    return decoded.every((item) => item !== null) ? decoded : null;
}

function decodeProposalArguments(wireArguments: Record<string, unknown>): Record<string, unknown> | null {
    const list = isRecord(wireArguments.list) ? wireArguments.list : null;
    const hasList = list !== null && Array.isArray(list.items);
    if (Array.isArray(wireArguments.commands) === hasList) {
        return null;
    }
    if (Array.isArray(wireArguments.commands)) {
        const commands = decodeItems(wireArguments.commands);
        return commands === null ? null : { ...wireArguments, commands };
    }
    const items = list !== null && Array.isArray(list.items) ? decodeItems(list.items) : null;
    return items === null ? null : { ...wireArguments, list: { ...list, items } };
}

function decodeMeasureArguments(
    wireArguments: Record<string, unknown>,
    proposal: Record<string, unknown>
): Record<string, unknown> | null {
    const items = Array.isArray(proposal.items) ? decodeItems(proposal.items) : null;
    return items === null ? null : { ...wireArguments, proposal: { ...proposal, items } };
}

/**
 * The canonical call a strict hosted reply encodes: every semantic list item's `argumentsJson`
 * decoded back into its `arguments` object, then held to the tool's canonical schema. `null`
 * refuses a reply whose encoding or decoded shape is invalid.
 */
export function decodeHostedProposalWireCall(call: ToolCallResult, canonicalSchema: ToolSchema): ToolCallResult | null {
    let decoded: Record<string, unknown> | null;
    if (call.name === COMMAND_BATCH_PROPOSAL_TOOL_NAME) {
        decoded = decodeProposalArguments(call.arguments);
    } else if (call.name === ANALYSIS_MEASURE_TOOL_NAME && isRecord(call.arguments.proposal)) {
        decoded = decodeMeasureArguments(call.arguments, call.arguments.proposal);
    } else {
        // Any other call, and a measurement of the project, carries no encoded leaf.
        return call;
    }
    if (decoded === null || !matchesJsonSchema(decoded, canonicalSchema.function.parameters)) {
        return null;
    }
    return { ...call, arguments: decoded };
}
