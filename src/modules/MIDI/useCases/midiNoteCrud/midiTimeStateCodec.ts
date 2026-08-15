import { sanitizeMidiStoreState, type MidiStoreState } from '../../stores/midiStore';

type NullNode = {
    type: 'null';
};

type UndefinedNode = {
    type: 'undefined';
};

type BooleanNode = {
    type: 'boolean';
    value: boolean;
};

type NumberNode = {
    type: 'number';
    value: number;
};

type NegativeZeroNode = {
    type: 'negative-zero';
};

type StringNode = {
    type: 'string';
    value: string;
};

type ArrayEntryNode = {
    index: number;
    value: MidiTimeStateNode;
};

type ArrayNode = {
    type: 'array';
    length: number;
    entries: readonly ArrayEntryNode[];
};

type ObjectEntryNode = {
    key: string;
    value: MidiTimeStateNode;
};

type ObjectNode = {
    type: 'object';
    prototype: 'object' | 'null';
    entries: readonly ObjectEntryNode[];
};

type MidiTimeStateNode =
    NullNode | UndefinedNode | BooleanNode | NumberNode | NegativeZeroNode | StringNode | ArrayNode | ObjectNode;

type DecodedValue = {
    status: 'decoded';
    value: unknown;
};

type RejectedValue = {
    status: 'rejected';
};

type DecodeValueResult = DecodedValue | RejectedValue;

const REJECTED_VALUE: RejectedValue = { status: 'rejected' };
const MAX_ARRAY_LENGTH = 0xffff_ffff;
const MIDI_STATE_REQUIRED_KEYS = ['probabilitySeed', 'notesByClipId', 'ccByClipId', 'pitchBendByClipId'] as const;
const MIDI_STATE_OPTIONAL_KEYS = ['migratedAbsoluteNoteClipIds'] as const;
const MIDI_STATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
    ...MIDI_STATE_REQUIRED_KEYS,
    ...MIDI_STATE_OPTIONAL_KEYS,
]);

function readDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) {
        return null;
    }

    const expectedKeySet = new Set(expectedKeys);
    const properties: Record<string, unknown> = {};
    for (const ownKey of ownKeys) {
        if (typeof ownKey !== 'string' || !expectedKeySet.has(ownKey)) {
            return null;
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        Object.defineProperty(properties, ownKey, {
            configurable: true,
            enumerable: true,
            value: descriptor.value,
            writable: true,
        });
    }

    return properties;
}

function readNodeType(value: unknown): string | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return null;
    }

    return typeof descriptor.value === 'string' ? descriptor.value : null;
}

function readDenseDataArray(value: unknown): readonly unknown[] | null {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
        return null;
    }

    const entries: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        entries.push(descriptor.value);
    }

    return entries;
}

function isSupportedMidiStoreState(value: unknown): value is MidiStoreState {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return false;
    }

    const candidate: Record<string, unknown> = {};
    for (const key of MIDI_STATE_REQUIRED_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return false;
        }
        candidate[key] = descriptor.value;
    }
    for (const key of MIDI_STATE_OPTIONAL_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) {
            continue;
        }
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return false;
        }
        candidate[key] = descriptor.value;
    }

    return sanitizeMidiStoreState(candidate) === candidate;
}

function hasCanonicalMidiStoreStateKeys(value: MidiStoreState): boolean {
    for (const ownKey of Reflect.ownKeys(value)) {
        if (typeof ownKey !== 'string' || !MIDI_STATE_ALLOWED_KEYS.has(ownKey)) {
            return false;
        }
    }

    return true;
}

function encodeArray(value: unknown[], ancestors: Set<object>): ArrayNode | null {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    const entries: ArrayEntryNode[] = [];
    for (const ownKey of ownKeys) {
        if (ownKey === 'length') {
            continue;
        }
        if (typeof ownKey !== 'string') {
            return null;
        }

        const index = Number(ownKey);
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== ownKey) {
            return null;
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }

        const encodedValue = encodeValue(descriptor.value, ancestors);
        if (!encodedValue) {
            return null;
        }
        entries.push({ index, value: encodedValue });
    }

    entries.sort((left, right) => left.index - right.index);
    return {
        type: 'array',
        length: value.length,
        entries,
    };
}

function compareObjectEntries(left: ObjectEntryNode, right: ObjectEntryNode): number {
    if (left.key < right.key) {
        return -1;
    }
    if (left.key > right.key) {
        return 1;
    }
    return 0;
}

function encodeObject(value: object, ancestors: Set<object>): ObjectNode | null {
    const runtimePrototype: unknown = Object.getPrototypeOf(value);
    let prototype: ObjectNode['prototype'];
    if (runtimePrototype === Object.prototype) {
        prototype = 'object';
    } else if (runtimePrototype === null) {
        prototype = 'null';
    } else {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    const entries: ObjectEntryNode[] = [];
    for (const ownKey of ownKeys) {
        if (typeof ownKey !== 'string') {
            return null;
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }

        const encodedValue = encodeValue(descriptor.value, ancestors);
        if (!encodedValue) {
            return null;
        }
        entries.push({ key: ownKey, value: encodedValue });
    }

    entries.sort(compareObjectEntries);
    return {
        type: 'object',
        prototype,
        entries,
    };
}

function encodeValue(value: unknown, ancestors: Set<object>): MidiTimeStateNode | null {
    if (value === null) {
        return { type: 'null' };
    }
    if (value === undefined) {
        return { type: 'undefined' };
    }
    if (typeof value === 'boolean') {
        return { type: 'boolean', value };
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return null;
        }
        if (Object.is(value, -0)) {
            return { type: 'negative-zero' };
        }
        return { type: 'number', value };
    }
    if (typeof value === 'string') {
        return { type: 'string', value };
    }
    if (typeof value !== 'object' || ancestors.has(value)) {
        return null;
    }

    ancestors.add(value);
    let encodedValue: MidiTimeStateNode | null;
    if (Array.isArray(value)) {
        encodedValue = encodeArray(value, ancestors);
    } else {
        encodedValue = encodeObject(value, ancestors);
    }
    ancestors.delete(value);
    return encodedValue;
}

function encodeStateUnchecked(value: unknown): MidiTimeStateNode | null {
    if (!isSupportedMidiStoreState(value)) {
        return null;
    }

    return encodeValue(value, new Set<object>());
}

function encodeState(value: unknown): MidiTimeStateNode | null {
    try {
        return encodeStateUnchecked(value);
    } catch {
        return null;
    }
}

function decodeArrayNode(properties: Record<string, unknown>, ancestors: Set<object>): DecodeValueResult {
    const length = properties.length;
    const encodedEntries = readDenseDataArray(properties.entries);
    if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_ARRAY_LENGTH ||
        !encodedEntries
    ) {
        return REJECTED_VALUE;
    }

    const decodedArray: unknown[] = [];
    decodedArray.length = length;
    let previousIndex = -1;
    for (const encodedEntry of encodedEntries) {
        const entry = readDataObject(encodedEntry, ['index', 'value']);
        if (!entry) {
            return REJECTED_VALUE;
        }

        const index = entry.index;
        if (
            typeof index !== 'number' ||
            !Number.isSafeInteger(index) ||
            index <= previousIndex ||
            index < 0 ||
            index >= length
        ) {
            return REJECTED_VALUE;
        }

        const decodedValue = decodeValue(entry.value, ancestors);
        if (decodedValue.status === 'rejected') {
            return REJECTED_VALUE;
        }

        decodedArray[index] = decodedValue.value;
        previousIndex = index;
    }

    return {
        status: 'decoded',
        value: decodedArray,
    };
}

function decodeObjectNode(properties: Record<string, unknown>, ancestors: Set<object>): DecodeValueResult {
    const encodedEntries = readDenseDataArray(properties.entries);
    const encodedPrototype = properties.prototype;
    if ((encodedPrototype !== 'object' && encodedPrototype !== 'null') || !encodedEntries) {
        return REJECTED_VALUE;
    }

    const decodedObject: Record<string, unknown> = {};
    if (encodedPrototype === 'null') {
        Object.setPrototypeOf(decodedObject, null);
    }
    let previousKey: string | null = null;
    for (const encodedEntry of encodedEntries) {
        const entry = readDataObject(encodedEntry, ['key', 'value']);
        if (!entry || typeof entry.key !== 'string') {
            return REJECTED_VALUE;
        }

        const key = entry.key;
        if (previousKey !== null && key <= previousKey) {
            return REJECTED_VALUE;
        }

        const decodedValue = decodeValue(entry.value, ancestors);
        if (decodedValue.status === 'rejected') {
            return REJECTED_VALUE;
        }

        Object.defineProperty(decodedObject, key, {
            configurable: true,
            enumerable: true,
            value: decodedValue.value,
            writable: true,
        });
        previousKey = key;
    }

    return {
        status: 'decoded',
        value: decodedObject,
    };
}

function decodeValue(value: unknown, ancestors: Set<object>): DecodeValueResult {
    if (value === null || typeof value !== 'object' || ancestors.has(value)) {
        return REJECTED_VALUE;
    }

    ancestors.add(value);
    try {
        const type = readNodeType(value);
        if (type === 'null') {
            return readDataObject(value, ['type']) ? { status: 'decoded', value: null } : REJECTED_VALUE;
        }
        if (type === 'undefined') {
            return readDataObject(value, ['type']) ? { status: 'decoded', value: undefined } : REJECTED_VALUE;
        }
        if (type === 'negative-zero') {
            return readDataObject(value, ['type']) ? { status: 'decoded', value: -0 } : REJECTED_VALUE;
        }
        if (type === 'boolean') {
            const properties = readDataObject(value, ['type', 'value']);
            if (!properties || typeof properties.value !== 'boolean') {
                return REJECTED_VALUE;
            }
            return { status: 'decoded', value: properties.value };
        }
        if (type === 'number') {
            const properties = readDataObject(value, ['type', 'value']);
            if (
                !properties ||
                typeof properties.value !== 'number' ||
                !Number.isFinite(properties.value) ||
                Object.is(properties.value, -0)
            ) {
                return REJECTED_VALUE;
            }
            return { status: 'decoded', value: properties.value };
        }
        if (type === 'string') {
            const properties = readDataObject(value, ['type', 'value']);
            if (!properties || typeof properties.value !== 'string') {
                return REJECTED_VALUE;
            }
            return { status: 'decoded', value: properties.value };
        }
        if (type === 'array') {
            const properties = readDataObject(value, ['type', 'length', 'entries']);
            if (!properties) {
                return REJECTED_VALUE;
            }
            return decodeArrayNode(properties, ancestors);
        }
        if (type === 'object') {
            const properties = readDataObject(value, ['type', 'prototype', 'entries']);
            if (!properties) {
                return REJECTED_VALUE;
            }
            return decodeObjectNode(properties, ancestors);
        }
        return REJECTED_VALUE;
    } finally {
        ancestors.delete(value);
    }
}

function decodeStateUnchecked(value: unknown): MidiStoreState | null {
    const decodedValue = decodeValue(value, new Set<object>());
    if (decodedValue.status === 'rejected') {
        return null;
    }

    if (!isSupportedMidiStoreState(decodedValue.value) || !hasCanonicalMidiStoreStateKeys(decodedValue.value)) {
        return null;
    }

    return decodedValue.value;
}

function decodeState(value: unknown): MidiStoreState | null {
    try {
        return decodeStateUnchecked(value);
    } catch {
        return null;
    }
}

function nodesEqual(left: MidiTimeStateNode, right: MidiTimeStateNode): boolean {
    if (left.type !== right.type) {
        return false;
    }
    if (left.type === 'null' || left.type === 'undefined' || left.type === 'negative-zero') {
        return true;
    }
    if (left.type === 'boolean' && right.type === 'boolean') {
        return left.value === right.value;
    }
    if (left.type === 'number' && right.type === 'number') {
        return Object.is(left.value, right.value);
    }
    if (left.type === 'string' && right.type === 'string') {
        return left.value === right.value;
    }
    if (left.type === 'array' && right.type === 'array') {
        if (left.length !== right.length || left.entries.length !== right.entries.length) {
            return false;
        }
        for (let index = 0; index < left.entries.length; index += 1) {
            const leftEntry = left.entries[index];
            const rightEntry = right.entries[index];
            if (!leftEntry || !rightEntry || leftEntry.index !== rightEntry.index) {
                return false;
            }
            if (!nodesEqual(leftEntry.value, rightEntry.value)) {
                return false;
            }
        }
        return true;
    }
    if (left.type === 'object' && right.type === 'object') {
        if (left.prototype !== right.prototype || left.entries.length !== right.entries.length) {
            return false;
        }
        for (let index = 0; index < left.entries.length; index += 1) {
            const leftEntry = left.entries[index];
            const rightEntry = right.entries[index];
            if (!leftEntry || !rightEntry || leftEntry.key !== rightEntry.key) {
                return false;
            }
            if (!nodesEqual(leftEntry.value, rightEntry.value)) {
                return false;
            }
        }
        return true;
    }
    return false;
}

function statesEqual(left: MidiStoreState, right: MidiStoreState): boolean {
    const encodedLeft = encodeState(left);
    const encodedRight = encodeState(right);
    if (!encodedLeft || !encodedRight) {
        return false;
    }

    return nodesEqual(encodedLeft, encodedRight);
}

function stateMatchesSnapshot(state: MidiStoreState, snapshot: MidiTimeStateNode): boolean {
    const encodedState = encodeState(state);
    if (!encodedState) {
        return false;
    }

    return nodesEqual(encodedState, snapshot);
}

export const midiTimeStateCodec = {
    decodeState,
    encodeState,
    stateMatchesSnapshot,
    statesEqual,
};
