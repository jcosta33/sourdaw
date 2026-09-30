import { type ToolSchema } from '../../models/ToolDefinitions';
import { COMMAND_BATCH_PROPOSAL_TOOL_NAME } from '../agentToolCatalog';

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

export function getHostedProposalWireToolSchema(schema: ToolSchema): ToolSchema {
    if (schema.function.name !== COMMAND_BATCH_PROPOSAL_TOOL_NAME) {
        return schema;
    }
    const wire = structuredClone(schema);
    const properties = wire.function.parameters.properties;
    const commands = objectMember(properties, 'commands');
    replaceArgumentLeaf(
        objectMember(commands, 'items'),
        'JSON string encoding one object of the discovered command’s typed arguments. Use the exact field names and values from the command catalog.'
    );
    const list = objectMember(properties, 'list');
    const listItems = objectMember(objectMember(list, 'properties'), 'items');
    replaceArgumentLeaf(
        objectMember(listItems, 'items'),
        'JSON string encoding one object of the discovered command’s typed arguments. Use exact catalog fields and values; references to an earlier batch binding use $<binding>.'
    );
    wire.function.description +=
        ' Use exactly one of commands or list. compiledCallIds may accompany either; for compiled calls alone use commands: [] with compiledCallIds. Each argumentsJson is a JSON-encoded object, while plan and compiledCallIds remain structured fields.';
    return wire;
}
