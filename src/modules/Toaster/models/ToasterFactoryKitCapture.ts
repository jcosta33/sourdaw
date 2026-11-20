import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type ToasterFactoryKitAction } from '../events/toasterAppActions';

import { fromToasterKitState, TOASTER_KIT_STATE_VERSION, toToasterKitState } from './ToasterKitState';

type Payload = ToasterFactoryKitAction['payload'];

function isNonemptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

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

export function validToasterFactoryKitCapture(payload: unknown): payload is Payload {
    if (
        !isRecord(payload) ||
        Object.keys(payload).length !== 6 ||
        !isNonemptyString(payload.deviceId) ||
        !isNonemptyString(payload.trackId) ||
        !isNonemptyString(payload.label) ||
        !Array.isArray(payload.deviceIds) ||
        !Array.from(payload.deviceIds).every(isNonemptyString) ||
        new Set(payload.deviceIds).size !== payload.deviceIds.length ||
        !payload.deviceIds.includes(payload.deviceId) ||
        (payload.before === null && payload.after === null)
    ) {
        return false;
    }
    const before = readChunkCapture(payload.before);
    const after = readChunkCapture(payload.after);
    return (
        before !== null &&
        after !== null &&
        (before.hasKit || after.hasKit) &&
        valuesEqual(before.unowned, after.unowned)
    );
}

export function invertToasterFactoryKitAction(action: ToasterFactoryKitAction): ToasterFactoryKitAction {
    const { before, after } = action.payload;
    return { type: action.type, payload: { ...action.payload, before: after, after: before } };
}

export function isToasterFactoryKitSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    return (
        action.type === 'setToasterFactoryKit' &&
        validToasterFactoryKitCapture(action.payload) &&
        !valuesEqual(action.payload.before, action.payload.after) &&
        valuesEqual(inverseAction, invertToasterFactoryKitAction(action)) &&
        valuesEqual(redoAction, action)
    );
}
