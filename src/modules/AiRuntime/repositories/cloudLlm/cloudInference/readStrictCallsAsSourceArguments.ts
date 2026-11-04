import { type ToolCallResult } from '../../../transformers/toolCallParser';

/*
 * The inverse of `walkSchemaNode` under `forceAllRequired` (toolSchemaProjectionCore.ts), kept
 * beside it: a change to how the projection makes an optional property nullable changes what
 * this must read back.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isObjectSchemaNode(node: Record<string, unknown>): boolean {
    return node.type === 'object' || isRecord(node.properties);
}

function admitsNull(node: Record<string, unknown>): boolean {
    if (node.type === 'null') {
        return true;
    }
    if (Array.isArray(node.type) && node.type.includes('null')) {
        return true;
    }
    return Array.isArray(node.anyOf) && node.anyOf.some((branch) => isRecord(branch) && admitsNull(branch));
}

function declaresEveryKey(branch: Record<string, unknown>, value: Record<string, unknown>): boolean {
    const properties = isRecord(branch.properties) ? branch.properties : null;
    return properties !== null && Object.keys(value).every((key) => Object.hasOwn(properties, key));
}

function readObjectMembers(value: Record<string, unknown>, node: Record<string, unknown>): Record<string, unknown> {
    const properties = isRecord(node.properties) ? node.properties : {};
    const required = new Set(isStringArray(node.required) ? node.required : []);
    const read: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
        const memberSchema = properties[key];
        if (!isRecord(memberSchema)) {
            read[key] = member;
            continue;
        }
        if (member === null && !required.has(key) && !admitsNull(memberSchema)) {
            continue;
        }
        read[key] = readUnsetOptionalsAsAbsent(member, memberSchema);
    }
    return read;
}

/**
 * The inverse of `walkSchemaNode` under `forceAllRequired`: that projection makes every
 * optional property required and nullable, so a strict OpenAI call states an unset
 * optional argument as `null`. This reads such a call back against the SOURCE schema:
 * a `null` is dropped where the property was optional and its source type does not
 * admit `null`, at every nesting depth the projection reaches. A `null` for a required
 * property, or for one whose source type admits `null`, is kept so validation still
 * judges it, as is every non-null value. For `anyOf`/`oneOf` the projection rewrote
 * each branch alike, so the value is read against the first object branch declaring
 * every key it carries.
 */
function readUnsetOptionalsAsAbsent(value: unknown, sourceNode: Record<string, unknown>): unknown {
    if (Array.isArray(value)) {
        const items = sourceNode.items;
        return isRecord(items) ? value.map((item) => readUnsetOptionalsAsAbsent(item, items)) : value;
    }
    if (!isRecord(value)) {
        return value;
    }
    let read: unknown = value;
    for (const key of ['anyOf', 'oneOf'] as const) {
        const branches = sourceNode[key];
        const branch = Array.isArray(branches)
            ? branches.find((candidate) => isRecord(candidate) && declaresEveryKey(candidate, value))
            : undefined;
        if (isRecord(branch)) {
            read = readUnsetOptionalsAsAbsent(read, branch);
        }
    }
    if (Array.isArray(sourceNode.allOf)) {
        for (const branch of sourceNode.allOf) {
            read = isRecord(branch) ? readUnsetOptionalsAsAbsent(read, branch) : read;
        }
    }
    if (!isRecord(read) || !isObjectSchemaNode(sourceNode)) {
        return read;
    }
    return readObjectMembers(read, sourceNode);
}

/** Reads each call of a strict OpenAI turn back against the source schema of the tool it names. */
export function readStrictCallsAsSourceArguments<Call extends { name: string; arguments: Record<string, unknown> }>(
    calls: readonly Call[],
    sourceSchemas: readonly { function: { name: string; parameters: Record<string, unknown> } }[]
): Call[] {
    return calls.map((call) => {
        const source = sourceSchemas.find((schema) => schema.function.name === call.name);
        if (source === undefined) {
            return call;
        }
        const read = readUnsetOptionalsAsAbsent(call.arguments, source.function.parameters);
        return isRecord(read) ? { ...call, arguments: read } : call;
    });
}
