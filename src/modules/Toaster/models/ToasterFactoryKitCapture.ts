import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { fromToasterKitState, TOASTER_KIT_STATE_VERSION, toToasterKitState } from './ToasterKitState';

function isJsonValue(value: unknown, depth = 0): boolean {
    if (depth > 64) {
        return false;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return Array.from(value).every((item) => isJsonValue(item, depth + 1));
    }
    return (
        isRecord(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
        Object.values(value).every((item) => isJsonValue(item, depth + 1))
    );
}

type ChunkCapture = { unowned: Record<string, unknown>; hasKit: boolean };

function readChunkCapture(chunk: unknown): ChunkCapture | null {
    if (chunk === null) {
        return { unowned: {}, hasKit: false };
    }
    if (
        !isRecord(chunk) ||
        Object.keys(chunk).length !== 2 ||
        chunk.version !== TOASTER_KIT_STATE_VERSION ||
        !isRecord(chunk.data) ||
        !isJsonValue(chunk.data)
    ) {
        return null;
    }
    const { kit, ...unowned } = chunk.data;
    if (!Object.hasOwn(chunk.data, 'kit')) {
        return { unowned, hasKit: false };
    }
    if (!isRecord(kit)) {
        return null;
    }

    // Hydration supplies fallbacks for corrupt fields. An exact capture must be
    // readable without substituting those fallbacks for persisted kit fields.
    const decoded = toToasterKitState(fromToasterKitState(chunk)).data.kit;
    if (!isRecord(decoded)) {
        return null;
    }
    const { morph, ...withoutMorph } = decoded;
    const expected = Object.hasOwn(kit, 'morph') ? { ...withoutMorph, morph } : withoutMorph;
    return valuesEqual(expected, kit) ? { unowned, hasKit: true } : null;
}

export function validToasterKitReplacement(beforeChunk: unknown, afterChunk: unknown): boolean {
    const before = readChunkCapture(beforeChunk);
    const after = readChunkCapture(afterChunk);
    return (
        before !== null &&
        after !== null &&
        (before.hasKit || after.hasKit) &&
        valuesEqual(before.unowned, after.unowned)
    );
}
