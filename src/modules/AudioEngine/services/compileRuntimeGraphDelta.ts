import {
    type RuntimeGraphDelta,
    type RuntimeGraphDeviceChainDelta,
    type RuntimeGraphDeltaDevice,
    type RuntimeGraphDeltaNode,
    type RuntimeGraphOutputDelta,
} from '../models/RuntimeGraphDelta';

const MAX_CORRELATION_REVISION_LENGTH = 256;
const MAX_DEVICE_COUNT = 64;
const MAX_ID_LENGTH = 128;
const MAX_NODE_COUNT = 2;
const MAX_PARAMETER_ID_COUNT = 128;

type RuntimeGraphDeltaCompilation =
    Readonly<{ status: 'compiled'; delta: RuntimeGraphDelta }> | Readonly<{ status: 'invalid'; reason: string }>;

type UnknownRecord = Record<string, unknown>;

function invalid(reason: string): RuntimeGraphDeltaCompilation {
    return { status: 'invalid', reason };
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isBoundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isStrictlySortedUniqueIds(values: readonly string[]): boolean {
    return values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0);
}

function compileDevice(value: unknown): RuntimeGraphDeltaDevice | string {
    if (
        !isRecord(value) ||
        !['id', 'type', 'parameterIds'].every((key) => key in value) ||
        !Object.keys(value).every((key) => ['id', 'type', 'externalInstanceId', 'parameterIds'].includes(key))
    ) {
        return 'Runtime graph device has an unsupported shape';
    }
    if (!isBoundedId(value.id) || !isBoundedId(value.type)) {
        return 'Runtime graph device id or type is invalid';
    }
    if (!isUnknownArray(value.parameterIds) || value.parameterIds.length > MAX_PARAMETER_ID_COUNT) {
        return 'Runtime graph device parameter ids exceed the bounded contract';
    }
    if (!value.parameterIds.every(isBoundedId) || !isStrictlySortedUniqueIds(value.parameterIds)) {
        return 'Runtime graph device parameter ids must be sorted, unique identifiers';
    }
    if (value.externalInstanceId !== undefined && !isBoundedId(value.externalInstanceId)) {
        return 'Runtime graph device external instance id is invalid';
    }
    return Object.freeze({
        id: value.id,
        type: value.type,
        ...(value.externalInstanceId !== undefined ? { externalInstanceId: value.externalInstanceId } : {}),
        parameterIds: Object.freeze([...value.parameterIds]),
    });
}

function compileNode(value: unknown): RuntimeGraphDeltaNode | string {
    if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'kind', 'devices'])) {
        return 'Runtime graph node has an unsupported shape';
    }
    if (!isBoundedId(value.id)) {
        return 'Runtime graph node id is invalid';
    }
    if (
        value.kind !== 'audio' &&
        value.kind !== 'midi' &&
        value.kind !== 'bus' &&
        value.kind !== 'master' &&
        value.kind !== 'folder'
    ) {
        return 'Runtime graph contains an unsupported node kind';
    }
    if (!isUnknownArray(value.devices) || value.devices.length > MAX_DEVICE_COUNT) {
        return 'Runtime graph device list exceeds the bounded contract';
    }

    const devices: RuntimeGraphDeltaDevice[] = [];
    const deviceIds = new Set<string>();
    for (const candidate of value.devices) {
        const device = compileDevice(candidate);
        if (typeof device === 'string') {
            return device;
        }
        if (deviceIds.has(device.id)) {
            return 'Runtime graph contains duplicate device ids';
        }
        deviceIds.add(device.id);
        devices.push(device);
    }
    return Object.freeze({ id: value.id, kind: value.kind, devices: Object.freeze(devices) });
}

function compileCorrelation(value: unknown): RuntimeGraphDelta['correlation'] | string {
    if (!isRecord(value) || !hasOnlyKeys(value, ['appRevision', 'projectRevision'])) {
        return 'Runtime graph delta correlation has an unsupported schema';
    }
    const appRevision = value.appRevision;
    if (typeof appRevision !== 'number' || !Number.isSafeInteger(appRevision) || appRevision < 0) {
        return 'Runtime graph delta app revision is invalid';
    }
    const projectRevision = value.projectRevision;
    if (
        typeof projectRevision !== 'string' ||
        projectRevision.length === 0 ||
        projectRevision.length > MAX_CORRELATION_REVISION_LENGTH
    ) {
        return 'Runtime graph delta project revision is invalid';
    }
    return Object.freeze({ appRevision, projectRevision });
}

function isSameDevice(left: RuntimeGraphDeltaDevice, right: RuntimeGraphDeltaDevice): boolean {
    return (
        left.id === right.id &&
        left.type === right.type &&
        left.externalInstanceId === right.externalInstanceId &&
        left.parameterIds.length === right.parameterIds.length &&
        left.parameterIds.every((parameterId, index) => parameterId === right.parameterIds[index])
    );
}

function hasSingleDeviceAddition(
    before: readonly RuntimeGraphDeltaDevice[],
    after: readonly RuntimeGraphDeltaDevice[]
): boolean {
    if (after.length !== before.length + 1) {
        return false;
    }
    let beforeIndex = 0;
    let inserted = false;
    for (const candidate of after) {
        const expected = before[beforeIndex];
        if (expected && isSameDevice(candidate, expected)) {
            beforeIndex++;
            continue;
        }
        if (inserted || before.some((device) => device.id === candidate.id)) {
            return false;
        }
        inserted = true;
    }
    return inserted && beforeIndex === before.length;
}

function hasSingleDeviceRemoval(
    before: readonly RuntimeGraphDeltaDevice[],
    after: readonly RuntimeGraphDeltaDevice[]
): boolean {
    return hasSingleDeviceAddition(after, before);
}

function hasSingleDeviceMove(
    before: readonly RuntimeGraphDeltaDevice[],
    after: readonly RuntimeGraphDeltaDevice[]
): boolean {
    if (before.length !== after.length || before.every((device, index) => isSameDevice(device, after[index]!))) {
        return false;
    }
    if (before.some((device) => !after.some((candidate) => isSameDevice(device, candidate)))) {
        return false;
    }
    for (let fromIndex = 0; fromIndex < before.length; fromIndex++) {
        const moved = before[fromIndex];
        if (!moved) {
            continue;
        }
        const withoutMoved = before.filter((_, index) => index !== fromIndex);
        for (let toIndex = 0; toIndex <= withoutMoved.length; toIndex++) {
            const candidate = [...withoutMoved];
            candidate.splice(toIndex, 0, moved);
            if (candidate.every((device, index) => isSameDevice(device, after[index]!))) {
                return true;
            }
        }
    }
    return false;
}

function compileOutputDelta(input: UnknownRecord): RuntimeGraphDeltaCompilation {
    if (!hasOnlyKeys(input, ['schemaVersion', 'command', 'correlation', 'nodes', 'edges', 'parameters'])) {
        return invalid('Runtime graph delta has an unsupported schema');
    }
    const correlation = compileCorrelation(input.correlation);
    if (typeof correlation === 'string') {
        return invalid(correlation);
    }
    if (!isUnknownArray(input.nodes) || input.nodes.length === 0 || input.nodes.length > MAX_NODE_COUNT) {
        return invalid('Runtime graph delta node count is unsupported');
    }
    if (!isUnknownArray(input.edges) || input.edges.length !== 1) {
        return invalid('Runtime graph delta must contain exactly one output edge');
    }
    if (!isUnknownArray(input.parameters) || input.parameters.length > 0) {
        return invalid('Runtime graph topology commands cannot carry parameter controls');
    }

    const nodes: RuntimeGraphDeltaNode[] = [];
    const nodeIds = new Set<string>();
    for (const candidate of input.nodes) {
        const node = compileNode(candidate);
        if (typeof node === 'string') {
            return invalid(node);
        }
        if (nodeIds.has(node.id)) {
            return invalid('Runtime graph contains duplicate node ids');
        }
        nodeIds.add(node.id);
        nodes.push(node);
    }

    const edge = input.edges[0];
    if (!isRecord(edge) || !hasOnlyKeys(edge, ['kind', 'sourceId', 'targetId'])) {
        return invalid('Runtime graph output edge has an unsupported shape');
    }
    if (edge.kind !== 'output' || !isBoundedId(edge.sourceId) || !isBoundedId(edge.targetId)) {
        return invalid('Runtime graph output edge is invalid');
    }
    if (edge.sourceId === edge.targetId) {
        return invalid('Runtime graph output edge cannot create a self-route');
    }
    if (nodes[0]?.id !== edge.sourceId) {
        return invalid('Runtime graph output edge must start at the first node');
    }
    const isTerminalTarget = edge.targetId === 'master' || edge.targetId === 'hw_out';
    if (isTerminalTarget ? nodes.length !== 1 : nodes.length !== 2 || nodes[1]?.id !== edge.targetId) {
        return invalid('Runtime graph output edge has a missing or unordered endpoint');
    }

    const delta: RuntimeGraphOutputDelta = Object.freeze({
        schemaVersion: 1,
        command: 'set-track-output',
        correlation,
        nodes: Object.freeze(nodes),
        edges: Object.freeze([
            Object.freeze({ kind: 'output', sourceId: edge.sourceId, targetId: edge.targetId }),
        ] as const),
        parameters: Object.freeze([] as const),
    });
    return { status: 'compiled', delta };
}

function compileDeviceChainDelta(input: UnknownRecord): RuntimeGraphDeltaCompilation {
    if (
        !hasOnlyKeys(input, ['schemaVersion', 'command', 'correlation', 'operation', 'before', 'after', 'parameters'])
    ) {
        return invalid('Runtime device-chain delta has an unsupported schema');
    }
    const correlation = compileCorrelation(input.correlation);
    if (typeof correlation === 'string') {
        return invalid(correlation);
    }
    if (!isUnknownArray(input.parameters) || input.parameters.length > 0) {
        return invalid('Runtime device-chain deltas cannot carry parameter controls');
    }
    const before = compileNode(input.before);
    const after = compileNode(input.after);
    if (typeof before === 'string') {
        return invalid(before);
    }
    if (typeof after === 'string') {
        return invalid(after);
    }
    if (before.id !== after.id || before.kind !== after.kind) {
        return invalid('Runtime device-chain delta must retain one track identity and kind');
    }
    let operation: RuntimeGraphDeviceChainDelta['operation'];
    if (input.operation === 'add-device' && hasSingleDeviceAddition(before.devices, after.devices)) {
        operation = input.operation;
    } else if (input.operation === 'remove-device' && hasSingleDeviceRemoval(before.devices, after.devices)) {
        operation = input.operation;
    } else if (input.operation === 'reorder-device' && hasSingleDeviceMove(before.devices, after.devices)) {
        operation = input.operation;
    } else {
        return invalid('Runtime device-chain delta operation does not match its ordered before/after topology');
    }
    const delta: RuntimeGraphDeviceChainDelta = Object.freeze({
        schemaVersion: 1,
        command: 'replace-track-device-chain',
        correlation,
        operation,
        before,
        after,
        parameters: Object.freeze([] as const),
    });
    return { status: 'compiled', delta };
}

/**
 * Validates and freezes the one-output graph-delta protocol before the live
 * engine touches an AudioNode. The command runs on the main/control thread;
 * worklet process paths never parse or allocate for it.
 */
export function compileRuntimeGraphDelta(input: unknown): RuntimeGraphDeltaCompilation {
    if (!isRecord(input)) {
        return invalid('Runtime graph delta has an unsupported schema');
    }
    if (input.schemaVersion !== 1) {
        return invalid('Runtime graph delta schema version or command is unsupported');
    }
    if (input.command === 'set-track-output') {
        return compileOutputDelta(input);
    }
    if (input.command === 'replace-track-device-chain') {
        return compileDeviceChainDelta(input);
    }
    return invalid('Runtime graph delta schema version or command is unsupported');
}
