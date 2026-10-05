import { type ToolSchema } from '../../models/ToolDefinitions';
import { ANALYSIS_MEASURE_TOOL_NAME, COMMAND_BATCH_PROPOSAL_TOOL_NAME } from '../agentToolCatalog';

const LIST_ARGUMENTS_DESCRIPTION =
    'JSON string encoding one object of the discovered command’s typed arguments. Use exact catalog fields and values; references to an earlier batch binding use $<binding>.';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectMember(parent: Record<string, unknown>, key: string): Record<string, unknown> {
    const member = parent[key];
    if (!isRecord(member)) {
        throw new TypeError(`Proposal tool schema is missing ${key}.`);
    }
    return member;
}

function replaceArgumentLeaf(item: Record<string, unknown>, description: string): void {
    const properties = objectMember(item, 'properties');
    if (!isRecord(properties.arguments) || !Array.isArray(item.required)) {
        throw new TypeError('Proposal tool schema has no required arguments object.');
    }
    delete properties.arguments;
    properties.argumentsJson = { type: 'string', description };
    item.required = item.required.map((key: unknown) => (key === 'arguments' ? 'argumentsJson' : key));
}

/** A semantic command list schema with each item's open arguments object encoded as a JSON string. */
function encodeListArguments(list: Record<string, unknown>): void {
    const listItems = objectMember(objectMember(list, 'properties'), 'items');
    replaceArgumentLeaf(objectMember(listItems, 'items'), LIST_ARGUMENTS_DESCRIPTION);
}

function getProposalWireToolSchema(schema: ToolSchema): ToolSchema {
    const wire = structuredClone(schema);
    const properties = wire.function.parameters.properties;
    const commands = objectMember(properties, 'commands');
    replaceArgumentLeaf(
        objectMember(commands, 'items'),
        'JSON string encoding one object of the discovered command’s typed arguments. Use the exact field names and values from the command catalog.'
    );
    encodeListArguments(objectMember(properties, 'list'));
    wire.function.description +=
        ' Use exactly one of commands or list. compiledCallIds may accompany either; for compiled calls alone use commands: [] with compiledCallIds. Each argumentsJson is a JSON-encoded object, while plan and compiledCallIds remain structured fields.';
    return wire;
}

/** The preview measurement carries the same semantic list a proposal does, so its leaves are encoded alike. */
function getMeasureWireToolSchema(schema: ToolSchema): ToolSchema {
    const wire = structuredClone(schema);
    encodeListArguments(objectMember(wire.function.parameters.properties, 'proposal'));
    wire.function.description += ' Each proposal item’s argumentsJson is a JSON-encoded object.';
    return wire;
}

/**
 * The schema a strict hosted provider is shown for a tool. Strict schemas cannot carry the open
 * command-arguments object a semantic list item holds, so every tool whose arguments include such
 * a list advertises that leaf as a JSON string, which `decodeHostedProposalWireCall` restores.
 */
export function getHostedProposalWireToolSchema(schema: ToolSchema): ToolSchema {
    if (schema.function.name === COMMAND_BATCH_PROPOSAL_TOOL_NAME) {
        return getProposalWireToolSchema(schema);
    }
    if (schema.function.name === ANALYSIS_MEASURE_TOOL_NAME) {
        return getMeasureWireToolSchema(schema);
    }
    return schema;
}
