import { sanitize_marker_store_state, type MarkerStoreState } from '../../stores/markerStore';
import { createClipWriteTargetIndex } from '../../stores/resolveEligibleClipWriteTarget';
import { sanitizeTrackSnapshot } from '../../stores/trackStore';

import type { TrackState } from '../../repositories/track/getTrackState';

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

type ArrayNode = {
    type: 'array';
    items: readonly StateNode[];
};

type ObjectEntryNode = {
    key: string;
    value: StateNode;
};

type ObjectNode = {
    type: 'object';
    prototype: 'object' | 'null';
    entries: readonly ObjectEntryNode[];
};

type StateNode =
    NullNode | UndefinedNode | BooleanNode | NumberNode | NegativeZeroNode | StringNode | ArrayNode | ObjectNode;

export type TimeOperationStateSnapshot = StateNode;

type DecodedValue = {
    status: 'decoded';
    value: unknown;
};

type RejectedValue = {
    status: 'rejected';
};

type DecodeValueResult = DecodedValue | RejectedValue;

const REJECTED_VALUE: RejectedValue = { status: 'rejected' };
const TRACK_STATE_KEYS = ['tracks', 'selectedTrackId'] as const;
const TRACK_STATE_WITH_GHOSTS_KEYS = ['tracks', 'selectedTrackId', 'ghostClips'] as const;

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

function readDenseArray(value: unknown): readonly unknown[] | null {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
        return null;
    }

    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        items.push(descriptor.value);
    }

    return items;
}

function encodeArray(value: unknown[], ancestors: Set<object>): ArrayNode | null {
    const items = readDenseArray(value);
    if (!items) {
        return null;
    }

    const encodedItems: StateNode[] = [];
    for (const item of items) {
        const encodedItem = encodeValue(item, ancestors);
        if (!encodedItem) {
            return null;
        }
        encodedItems.push(encodedItem);
    }

    return {
        type: 'array',
        items: encodedItems,
    };
}

function compareEntries(left: ObjectEntryNode, right: ObjectEntryNode): number {
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

    const entries: ObjectEntryNode[] = [];
    for (const ownKey of Reflect.ownKeys(value)) {
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

    entries.sort(compareEntries);
    return {
        type: 'object',
        prototype,
        entries,
    };
}

function encodeValue(value: unknown, ancestors: Set<object>): StateNode | null {
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
    let encodedValue: StateNode | null;
    if (Array.isArray(value)) {
        encodedValue = encodeArray(value, ancestors);
    } else {
        encodedValue = encodeObject(value, ancestors);
    }
    ancestors.delete(value);
    return encodedValue;
}

function readNodeType(value: unknown): string | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return null;
    }
    if (typeof descriptor.value !== 'string') {
        return null;
    }
    return descriptor.value;
}

function decodeArrayNode(properties: Record<string, unknown>, ancestors: Set<object>): DecodeValueResult {
    const encodedItems = readDenseArray(properties.items);
    if (!encodedItems) {
        return REJECTED_VALUE;
    }

    const decodedItems: unknown[] = [];
    for (const encodedItem of encodedItems) {
        const decodedItem = decodeValue(encodedItem, ancestors);
        if (decodedItem.status === 'rejected') {
            return REJECTED_VALUE;
        }
        decodedItems.push(decodedItem.value);
    }

    return {
        status: 'decoded',
        value: decodedItems,
    };
}

function decodeObjectNode(properties: Record<string, unknown>, ancestors: Set<object>): DecodeValueResult {
    const encodedPrototype = properties.prototype;
    if (encodedPrototype !== 'object' && encodedPrototype !== 'null') {
        return REJECTED_VALUE;
    }
    const encodedEntries = readDenseArray(properties.entries);
    if (!encodedEntries) {
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
        if (previousKey !== null && entry.key <= previousKey) {
            return REJECTED_VALUE;
        }

        const decodedValue = decodeValue(entry.value, ancestors);
        if (decodedValue.status === 'rejected') {
            return REJECTED_VALUE;
        }
        Object.defineProperty(decodedObject, entry.key, {
            configurable: true,
            enumerable: true,
            value: decodedValue.value,
            writable: true,
        });
        previousKey = entry.key;
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
            const properties = readDataObject(value, ['type', 'items']);
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

function nodesEqual(left: StateNode, right: StateNode): boolean {
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
        if (left.items.length !== right.items.length) {
            return false;
        }
        for (let index = 0; index < left.items.length; index += 1) {
            const leftItem = left.items[index];
            const rightItem = right.items[index];
            if (!leftItem || !rightItem || !nodesEqual(leftItem, rightItem)) {
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

function encodeCanonicalValue(value: unknown): StateNode | null {
    try {
        return encodeValue(value, new Set<object>());
    } catch {
        return null;
    }
}

function valuesEqual(left: unknown, right: unknown): boolean {
    const encodedLeft = encodeCanonicalValue(left);
    const encodedRight = encodeCanonicalValue(right);
    if (!encodedLeft || !encodedRight) {
        return false;
    }
    return nodesEqual(encodedLeft, encodedRight);
}

function removeUndefinedProperties(value: unknown): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            removeUndefinedProperties(item);
        }
        return;
    }
    if (value === null || typeof value !== 'object') {
        return;
    }

    for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            continue;
        }
        if (descriptor.value === undefined) {
            Reflect.deleteProperty(value, key);
            continue;
        }
        removeUndefinedProperties(descriptor.value);
    }
}

function normalizeGhostClips(value: unknown): unknown[] | null {
    const ghostClips = readDenseArray(value);
    if (!ghostClips) {
        return null;
    }
    const encodedGhostClips = encodeCanonicalValue(ghostClips);
    if (!encodedGhostClips) {
        return null;
    }
    const decodedGhostClips = decodeCanonicalValue(encodedGhostClips);
    const detachedGhostClips = readDenseArray(decodedGhostClips);
    if (!detachedGhostClips) {
        return null;
    }

    const syntheticTrack = {
        id: '__time-operation-codec__',
        name: 'Codec',
        kind: 'audio',
        clips: detachedGhostClips,
    };
    const sanitized = sanitizeTrackSnapshot({
        tracks: [syntheticTrack],
        selectedTrackId: null,
    });
    const sanitizedTrack = sanitized.tracks[0];
    if (!sanitizedTrack) {
        return null;
    }
    removeUndefinedProperties(detachedGhostClips);
    const normalizedClips = structuredClone(sanitizedTrack.clips);
    removeUndefinedProperties(normalizedClips);
    if (!valuesEqual(detachedGhostClips, normalizedClips)) {
        return null;
    }
    return normalizedClips;
}

function createSanitizerTrackCandidate(value: unknown): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }
    if (!Object.hasOwn(value, 'kind') || Reflect.get(value, 'kind') !== 'vca') {
        return value;
    }
    return {
        ...value,
        kind: 'folder',
    };
}

function validateTrackState(value: unknown): value is TrackState {
    let properties = readDataObject(value, TRACK_STATE_KEYS);
    if (!properties) {
        properties = readDataObject(value, TRACK_STATE_WITH_GHOSTS_KEYS);
    }
    if (!properties) {
        return false;
    }

    const tracks = readDenseArray(properties.tracks);
    if (!tracks) {
        return false;
    }
    if (properties.selectedTrackId !== null && typeof properties.selectedTrackId !== 'string') {
        return false;
    }

    const encodedTracks = encodeCanonicalValue(tracks);
    if (!encodedTracks) {
        return false;
    }
    const decodedTracks = decodeCanonicalValue(encodedTracks);
    const detachedTracks = readDenseArray(decodedTracks);
    if (!detachedTracks) {
        return false;
    }
    const sanitizerTracks = detachedTracks.map(createSanitizerTrackCandidate);
    const sanitized = sanitizeTrackSnapshot({
        tracks: sanitizerTracks,
        selectedTrackId: properties.selectedTrackId,
    });
    const normalizedTracks = structuredClone(sanitized.tracks);
    for (let index = 0; index < detachedTracks.length; index += 1) {
        const sourceTrack = detachedTracks[index];
        const normalizedTrack = normalizedTracks[index];
        if (
            sourceTrack !== null &&
            typeof sourceTrack === 'object' &&
            !Array.isArray(sourceTrack) &&
            Reflect.get(sourceTrack, 'kind') === 'vca' &&
            normalizedTrack
        ) {
            Object.assign(normalizedTrack, { kind: 'vca' });
        }
    }
    removeUndefinedProperties(detachedTracks);
    removeUndefinedProperties(normalizedTracks);
    if (!valuesEqual(detachedTracks, normalizedTracks) || sanitized.selectedTrackId !== properties.selectedTrackId) {
        return false;
    }

    if (Object.hasOwn(properties, 'ghostClips')) {
        const normalizedGhostClips = normalizeGhostClips(properties.ghostClips);
        if (!normalizedGhostClips) {
            return false;
        }
    }

    const candidate: TrackState = {
        tracks: sanitized.tracks,
        selectedTrackId: sanitized.selectedTrackId,
    };
    return createClipWriteTargetIndex(candidate).status === 'valid';
}

function validateMarkerState(value: unknown): value is MarkerStoreState {
    const sanitized = sanitize_marker_store_state(value);
    return sanitized === value;
}

function decodeCanonicalValue(value: unknown): unknown {
    try {
        const decoded = decodeValue(value, new Set<object>());
        if (decoded.status === 'rejected') {
            return null;
        }
        return decoded.value;
    } catch {
        return null;
    }
}

function encodeTrackState(value: unknown): StateNode | null {
    const encoded = encodeCanonicalValue(value);
    if (!encoded) {
        return null;
    }
    if (!validateTrackState(value)) {
        return null;
    }
    return encoded;
}

function decodeTrackState(value: unknown): TrackState | null {
    const decoded = decodeCanonicalValue(value);
    if (!validateTrackState(decoded)) {
        return null;
    }
    return decoded;
}

function encodeMarkerState(value: unknown): StateNode | null {
    const encoded = encodeCanonicalValue(value);
    if (!encoded) {
        return null;
    }
    if (!validateMarkerState(value)) {
        return null;
    }
    return encoded;
}

function decodeMarkerState(value: unknown): MarkerStoreState | null {
    const decoded = decodeCanonicalValue(value);
    if (!validateMarkerState(decoded)) {
        return null;
    }
    return decoded;
}

function stateMatchesSnapshot(state: unknown, snapshot: unknown): boolean {
    const encodedState = encodeCanonicalValue(state);
    const decodedSnapshot = decodeCanonicalValue(snapshot);
    if (!encodedState || decodedSnapshot === null) {
        return false;
    }
    const encodedSnapshot = encodeCanonicalValue(decodedSnapshot);
    if (!encodedSnapshot) {
        return false;
    }
    return nodesEqual(encodedState, encodedSnapshot);
}

function cloneJsonPlan(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const encoded = encodeCanonicalValue(value);
    if (!encoded) {
        return null;
    }

    try {
        const serialized = JSON.stringify(value);
        const cloned: unknown = JSON.parse(serialized);
        const encodedClone = encodeCanonicalValue(cloned);
        if (!encodedClone || !nodesEqual(encoded, encodedClone)) {
            return null;
        }
        if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) {
            return null;
        }
        return readDataObject(cloned, Object.keys(cloned));
    } catch {
        return null;
    }
}

export const timeOperationStateCodec = {
    cloneJsonPlan,
    decodeMarkerState,
    decodeTrackState,
    encodeMarkerState,
    encodeTrackState,
    markerStateMatchesSnapshot: stateMatchesSnapshot,
    nodesEqual,
    trackStateMatchesSnapshot: stateMatchesSnapshot,
    valuesEqual,
};
