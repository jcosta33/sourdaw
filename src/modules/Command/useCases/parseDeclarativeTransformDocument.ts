import {
    DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH,
    DECLARATIVE_TRANSFORM_MAX_SEED,
    DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT,
    DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH,
    DECLARATIVE_TRANSFORM_MAX_VARIABLES,
    DECLARATIVE_TRANSFORM_MIN_SEED,
    DECLARATIVE_TRANSFORM_SCHEMA_VERSION,
    DECLARATIVE_TRANSFORM_UNITS,
    type DeclarativeTransformUnit,
    type DeclarativeTransformDocument,
    type TransformArgument,
    type TransformCondition,
    type TransformExpression,
    type TransformSelector,
    type TransformStep,
} from '../models/DeclarativeTransform';

const MAX_DOCUMENT_NODES = 4096;
const MAX_DOCUMENT_DEPTH = 32;
const MAX_DOCUMENT_STRING_LENGTH = 512;
const MAX_DOCUMENT_MEMBERS = 128;

type ParseResult =
    { status: 'accepted'; document: DeclarativeTransformDocument } | { status: 'rejected'; reason: string };

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
    return (
        required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
    );
}

function label(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_DOCUMENT_STRING_LENGTH;
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function transformUnit(value: unknown): value is DeclarativeTransformUnit {
    return typeof value === 'string' && DECLARATIVE_TRANSFORM_UNITS.some((unit) => unit === value);
}

/** Refuse oversized and cyclic provider objects before any recursive grammar walk. */
function boundedJson(value: unknown): boolean {
    const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    const visited = new Set<object>();
    let nodes = 0;
    while (stack.length > 0) {
        const current = stack.pop()!;
        nodes += 1;
        if (nodes > MAX_DOCUMENT_NODES || current.depth > MAX_DOCUMENT_DEPTH) {
            return false;
        }
        if (typeof current.value === 'string') {
            if (current.value.length > MAX_DOCUMENT_STRING_LENGTH) {
                return false;
            }
            continue;
        }
        if (current.value === null || typeof current.value === 'boolean') {
            continue;
        }
        if (typeof current.value === 'number') {
            if (!Number.isFinite(current.value)) {
                return false;
            }
            continue;
        }
        if (typeof current.value !== 'object' || visited.has(current.value)) {
            return false;
        }
        visited.add(current.value);
        if (Array.isArray(current.value)) {
            if (current.value.length > MAX_DOCUMENT_MEMBERS) {
                return false;
            }
            for (const entry of current.value) {
                stack.push({ value: entry, depth: current.depth + 1 });
            }
            continue;
        }
        if (Object.keys(current.value).length > MAX_DOCUMENT_MEMBERS) {
            return false;
        }
        for (const entry of Object.values(current.value)) {
            stack.push({ value: entry, depth: current.depth + 1 });
        }
    }
    return true;
}

function scalarExpression(value: Record<string, unknown>): TransformExpression | null {
    if (
        value.node === 'const' &&
        record(value.quantity) &&
        keys(value, ['node', 'quantity']) &&
        keys(value.quantity, ['unit', 'value']) &&
        transformUnit(value.quantity.unit) &&
        finite(value.quantity.value)
    ) {
        return {
            node: 'const',
            quantity: {
                unit: value.quantity.unit,
                value: value.quantity.value,
            },
        };
    }
    if (value.node === 'var' && keys(value, ['node', 'name']) && label(value.name)) {
        return { node: 'var', name: value.name };
    }
    if (value.node === 'index' && keys(value, ['node', 'item']) && label(value.item)) {
        return { node: 'index', item: value.item };
    }
    if (
        value.node === 'field' &&
        keys(value, ['node', 'item', 'field']) &&
        label(value.item) &&
        (value.field === 'startBeat' || value.field === 'endBeat' || value.field === 'length')
    ) {
        return { node: 'field', item: value.item, field: value.field };
    }
    return null;
}

function compositeExpression(value: Record<string, unknown>, depth: number): TransformExpression | null {
    if ((value.node === 'secondsToBeats' || value.node === 'beatsToSeconds') && keys(value, ['node', 'value'])) {
        const nested = expression(value.value, depth + 1);
        return nested === null ? null : { node: value.node, value: nested };
    }
    if (
        keys(value, ['node', 'left', 'right']) &&
        (value.node === 'add' || value.node === 'sub' || value.node === 'mul' || value.node === 'div')
    ) {
        const left = expression(value.left, depth + 1);
        const right = expression(value.right, depth + 1);
        return left === null || right === null ? null : { node: value.node, left, right };
    }
    if (value.node === 'random' && keys(value, ['node', 'min', 'max'])) {
        const min = expression(value.min, depth + 1);
        const max = expression(value.max, depth + 1);
        return min === null || max === null ? null : { node: 'random', min, max };
    }
    return null;
}

function expression(value: unknown, depth = 1): TransformExpression | null {
    if (!record(value) || depth > DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH) {
        return null;
    }
    return scalarExpression(value) ?? compositeExpression(value, depth);
}

function comparisonCondition(value: Record<string, unknown>): TransformCondition | null {
    if (
        keys(value, ['cmp', 'left', 'right']) &&
        (value.cmp === 'lt' || value.cmp === 'le' || value.cmp === 'eq' || value.cmp === 'ge' || value.cmp === 'gt')
    ) {
        const left = expression(value.left);
        const right = expression(value.right);
        return left === null || right === null ? null : { cmp: value.cmp, left, right };
    }
    return null;
}

function logicalCondition(value: Record<string, unknown>, depth: number): TransformCondition | null {
    if (
        (Object.hasOwn(value, 'all') || Object.hasOwn(value, 'any')) &&
        keys(value, [], ['all', 'any']) &&
        Object.keys(value).length === 1
    ) {
        const branch = Object.hasOwn(value, 'all') ? 'all' : 'any';
        const members = value[branch];
        if (!Array.isArray(members) || members.length === 0 || members.length > MAX_DOCUMENT_MEMBERS) {
            return null;
        }
        const parsed = members.map((member) => condition(member, depth + 1));
        if (parsed.some((member) => member === null)) {
            return null;
        }
        const conditions = parsed.filter((member): member is TransformCondition => member !== null);
        if (branch === 'all') {
            return { all: conditions };
        }
        return { any: conditions };
    }
    return null;
}

function condition(value: unknown, depth = 1): TransformCondition | null {
    if (!record(value) || depth > DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH) {
        return null;
    }
    return comparisonCondition(value) ?? logicalCondition(value, depth);
}

function argument(value: unknown): TransformArgument | null {
    if (!record(value)) {
        return null;
    }
    if (Object.hasOwn(value, 'node')) {
        return expression(value);
    }
    if (
        keys(value, ['literal']) &&
        (label(value.literal) || finite(value.literal) || typeof value.literal === 'boolean')
    ) {
        return { literal: value.literal };
    }
    if (keys(value, ['itemId']) && label(value.itemId)) {
        return { itemId: value.itemId };
    }
    if (keys(value, ['bindingRef']) && label(value.bindingRef)) {
        return { bindingRef: value.bindingRef };
    }
    return null;
}

function eachStep(value: Record<string, unknown>, depth: number, id: string): TransformStep | null {
    if (
        value.kind === 'each' &&
        keys(value, ['id', 'kind', 'selector', 'as', 'body']) &&
        label(value.selector) &&
        label(value.as) &&
        Array.isArray(value.body)
    ) {
        const body = value.body.map((member) => step(member, depth + 1));
        if (body.some((member) => member === null)) {
            return null;
        }
        return {
            id,
            kind: 'each',
            selector: value.selector,
            as: value.as,
            body: body.filter((member): member is TransformStep => member !== null),
        };
    }
    return null;
}

function whenStep(value: Record<string, unknown>, depth: number, id: string): TransformStep | null {
    if (value.kind === 'when' && keys(value, ['id', 'kind', 'condition', 'then']) && Array.isArray(value.then)) {
        const parsedCondition = condition(value.condition);
        const then = value.then.map((member) => step(member, depth + 1));
        if (parsedCondition === null || then.some((member) => member === null)) {
            return null;
        }
        return {
            id,
            kind: 'when',
            condition: parsedCondition,
            then: then.filter((member): member is TransformStep => member !== null),
        };
    }
    return null;
}

function emitStep(value: Record<string, unknown>, id: string): TransformStep | null {
    if (
        value.kind !== 'emit' ||
        !keys(value, ['id', 'kind', 'operation', 'arguments'], ['binding', 'dependsOn']) ||
        !label(value.operation) ||
        !record(value.arguments) ||
        (value.binding !== undefined && !label(value.binding)) ||
        (value.dependsOn !== undefined &&
            (!Array.isArray(value.dependsOn) ||
                value.dependsOn.length > MAX_DOCUMENT_MEMBERS ||
                !value.dependsOn.every(label)))
    ) {
        return null;
    }
    const parsedArguments: Record<string, TransformArgument> = {};
    for (const [name, source] of Object.entries(value.arguments)) {
        if (!label(name)) {
            return null;
        }
        const parsed = argument(source);
        if (parsed === null) {
            return null;
        }
        parsedArguments[name] = parsed;
    }
    const emitted: Extract<TransformStep, { kind: 'emit' }> = {
        id,
        kind: 'emit',
        operation: value.operation,
        arguments: parsedArguments,
    };
    if (value.binding !== undefined) {
        emitted.binding = value.binding;
    }
    if (value.dependsOn !== undefined) {
        emitted.dependsOn = value.dependsOn;
    }
    return emitted;
}

function step(value: unknown, depth = 1): TransformStep | null {
    if (!record(value) || depth > DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH || !label(value.id)) {
        return null;
    }
    const id = value.id;
    if (value.kind === 'each') {
        return eachStep(value, depth, id);
    }
    if (value.kind === 'when') {
        return whenStep(value, depth, id);
    }
    return emitStep(value, id);
}

function validSelectorHeader(value: Record<string, unknown>): value is Record<string, unknown> & {
    target: TransformSelector['target'];
    limit: number;
} {
    return (
        keys(value, ['target', 'limit'], ['where']) &&
        (value.target === 'track' || value.target === 'clip') &&
        Number.isInteger(value.limit) &&
        finite(value.limit) &&
        value.limit >= 1 &&
        value.limit <= DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT
    );
}

function optionalNonnegative(value: unknown): boolean {
    return value === undefined || (finite(value) && value >= 0);
}

function validSelectorWhere(
    value: unknown
): value is Record<string, unknown> & NonNullable<TransformSelector['where']> {
    if (!record(value)) {
        return false;
    }
    const { contentType, nameIncludes, trackId, startsAtOrAfterBeat, endsAtOrBeforeBeat } = value;
    return (
        keys(value, [], ['contentType', 'nameIncludes', 'trackId', 'startsAtOrAfterBeat', 'endsAtOrBeforeBeat']) &&
        (contentType === undefined || contentType === null || contentType === 'audio' || contentType === 'midi') &&
        (nameIncludes === undefined || label(nameIncludes)) &&
        (trackId === undefined || label(trackId)) &&
        optionalNonnegative(startsAtOrAfterBeat) &&
        optionalNonnegative(endsAtOrBeforeBeat)
    );
}

function selectorWhere(value: unknown): NonNullable<TransformSelector['where']> | null {
    if (!validSelectorWhere(value)) {
        return null;
    }
    const { contentType, nameIncludes, trackId, startsAtOrAfterBeat, endsAtOrBeforeBeat } = value;
    const where: NonNullable<TransformSelector['where']> = {};
    if (contentType !== undefined) {
        where.contentType = contentType;
    }
    if (nameIncludes !== undefined) {
        where.nameIncludes = nameIncludes;
    }
    if (trackId !== undefined) {
        where.trackId = trackId;
    }
    if (startsAtOrAfterBeat !== undefined) {
        where.startsAtOrAfterBeat = startsAtOrAfterBeat;
    }
    if (endsAtOrBeforeBeat !== undefined) {
        where.endsAtOrBeforeBeat = endsAtOrBeforeBeat;
    }
    return where;
}

function selector(value: unknown): TransformSelector | null {
    if (!record(value) || !validSelectorHeader(value)) {
        return null;
    }
    if (value.where === undefined) {
        return { target: value.target, limit: value.limit };
    }
    const where = selectorWhere(value.where);
    return where === null ? null : { target: value.target, limit: value.limit, where };
}

type DocumentHeader = Record<string, unknown> & {
    schemaVersion: typeof DECLARATIVE_TRANSFORM_SCHEMA_VERSION;
    name: string;
    seed: number;
    variables: Record<string, unknown>;
    selectors: Record<string, unknown>;
    steps: unknown[];
    assertions: unknown[];
};

function validDocumentHeader(value: Record<string, unknown>): value is DocumentHeader {
    return (
        keys(value, ['schemaVersion', 'name', 'seed', 'variables', 'selectors', 'steps', 'assertions']) &&
        value.schemaVersion === DECLARATIVE_TRANSFORM_SCHEMA_VERSION &&
        label(value.name) &&
        Number.isInteger(value.seed) &&
        finite(value.seed) &&
        value.seed >= DECLARATIVE_TRANSFORM_MIN_SEED &&
        value.seed <= DECLARATIVE_TRANSFORM_MAX_SEED &&
        record(value.variables) &&
        Object.keys(value.variables).length <= DECLARATIVE_TRANSFORM_MAX_VARIABLES &&
        record(value.selectors) &&
        Array.isArray(value.steps) &&
        Array.isArray(value.assertions)
    );
}

export function parseDeclarativeTransformDocument(value: unknown): ParseResult {
    if (!boundedJson(value) || !record(value) || !validDocumentHeader(value)) {
        return {
            status: 'rejected',
            reason: 'Declarative transform document has invalid structure or exceeds a bound.',
        };
    }
    const variables: Record<string, TransformExpression> = {};
    for (const [name, source] of Object.entries(value.variables)) {
        const parsed = expression(source);
        if (!label(name) || parsed === null) {
            return { status: 'rejected', reason: 'Invalid transform variable.' };
        }
        variables[name] = parsed;
    }
    const selectors: Record<string, TransformSelector> = {};
    for (const [name, source] of Object.entries(value.selectors)) {
        const parsed = selector(source);
        if (!label(name) || parsed === null) {
            return { status: 'rejected', reason: 'Invalid transform selector.' };
        }
        selectors[name] = parsed;
    }
    const steps = value.steps.map((source) => step(source));
    if (steps.some((entry) => entry === null)) {
        return { status: 'rejected', reason: 'Invalid transform step or depth.' };
    }
    const assertions = value.assertions.map((source) => {
        if (!record(source) || !keys(source, ['condition', 'message']) || !label(source.message)) {
            return null;
        }
        const parsed = condition(source.condition);
        return parsed === null ? null : { condition: parsed, message: source.message };
    });
    if (assertions.some((entry) => entry === null)) {
        return { status: 'rejected', reason: 'Invalid transform assertion.' };
    }
    return {
        status: 'accepted',
        document: {
            schemaVersion: value.schemaVersion,
            name: value.name,
            seed: value.seed,
            variables,
            selectors,
            steps: steps.filter((entry): entry is TransformStep => entry !== null),
            assertions: assertions.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        },
    };
}
