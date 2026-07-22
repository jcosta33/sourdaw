import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type ChordEvent } from '../models/ChordEvent';
import { CHORD_TYPES, type ChordType } from '../models/ChordTypes';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

export const defaultChordTrackState: ChordTrackState = { enabled: false, events: [] };

const DOC_PREFIX_ROOT = 'root';
const CHORD_TRACK_CRDT_SCHEMA_VERSION = 1;

type MutableRecord = Record<string, unknown>;
type ChordEventEntity = { deleted: boolean; value: ChordEvent };
type ChordTrackCrdtState = {
    schemaVersion: number;
    enabled: boolean;
    events: Record<string, ChordEventEntity>;
};

type ChordEventCandidate = {
    beat?: unknown;
    duration?: unknown;
    id?: unknown;
    quality?: unknown;
    root?: unknown;
};

type ChordTrackStateCandidate = {
    enabled?: unknown;
    events?: unknown;
};

function isChordEventCandidate(value: unknown): value is ChordEventCandidate {
    return typeof value === 'object' && value !== null;
}

function isChordTrackStateCandidate(value: unknown): value is ChordTrackStateCandidate {
    return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isRootValue(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 11;
}

function isDurationValue(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0.25;
}

function isChordType(value: unknown): value is ChordType {
    if (typeof value !== 'string') {
        return false;
    }

    return Object.hasOwn(CHORD_TYPES, value);
}

function isChordEvent(value: unknown): value is ChordEvent {
    if (!isChordEventCandidate(value)) {
        return false;
    }

    return (
        typeof value.id === 'string' &&
        isNonNegativeFiniteNumber(value.beat) &&
        isRootValue(value.root) &&
        isChordType(value.quality) &&
        isDurationValue(value.duration)
    );
}

function isChordTrackState(value: unknown): value is ChordTrackState {
    if (!isChordTrackStateCandidate(value)) {
        return false;
    }

    return typeof value.enabled === 'boolean' && Array.isArray(value.events) && value.events.every(isChordEvent);
}

function isRecord(value: unknown): value is MutableRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareIds(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

function copyEvent(event: ChordEvent): ChordEvent {
    return { ...event };
}

function normalizeState(value: unknown): ChordTrackState {
    if (!isChordTrackState(value)) {
        return defaultChordTrackState;
    }
    return {
        enabled: value.enabled,
        events: [...value.events].sort((left, right) => left.beat - right.beat || compareIds(left.id, right.id)),
    };
}

function isCrdtState(value: unknown): value is ChordTrackCrdtState {
    return (
        isRecord(value) &&
        value.schemaVersion === CHORD_TRACK_CRDT_SCHEMA_VERSION &&
        typeof value.enabled === 'boolean' &&
        isRecord(value.events)
    );
}

function assertSupportedSchema(value: unknown): void {
    if (!isRecord(value) || !Object.hasOwn(value, 'schemaVersion')) {
        return;
    }
    if (value.schemaVersion !== CHORD_TRACK_CRDT_SCHEMA_VERSION) {
        throw new Error(`Unsupported chord-track CRDT schema version: ${String(value.schemaVersion)}`);
    }
}

function encodeState(value: ChordTrackState): ChordTrackCrdtState {
    const state = normalizeState(value);
    return {
        schemaVersion: CHORD_TRACK_CRDT_SCHEMA_VERSION,
        enabled: state.enabled,
        events: Object.fromEntries(
            state.events.map((event) => [event.id, { deleted: false, value: copyEvent(event) }])
        ),
    };
}

function decodeState(value: unknown): ChordTrackState {
    assertSupportedSchema(value);
    if (!isCrdtState(value)) {
        return normalizeState(value);
    }
    const events = Object.entries(value.events)
        .sort(([left], [right]) => compareIds(left, right))
        .flatMap(([, entity]) => (isRecord(entity) && entity.deleted === false ? [entity.value] : []));
    return normalizeState({ enabled: value.enabled, events });
}

function encodeMigratedState(previous: unknown, desired: ChordTrackState): ChordTrackCrdtState {
    const encoded = encodeState(desired);
    const legacy = normalizeState(previous);
    if (!isChordTrackState(previous)) {
        return encoded;
    }
    const desiredIds = new Set(desired.events.map((event) => event.id));
    for (const event of legacy.events) {
        if (!desiredIds.has(event.id)) {
            encoded.events[event.id] = { deleted: true, value: copyEvent(event) };
        }
    }
    return encoded;
}

function replaceIfChanged(target: MutableRecord, key: string, value: unknown): void {
    if (JSON.stringify(target[key]) !== JSON.stringify(value)) {
        target[key] = value;
    }
}

function syncEventValue(target: MutableRecord, event: ChordEvent): void {
    replaceIfChanged(target, 'id', event.id);
    replaceIfChanged(target, 'beat', event.beat);
    replaceIfChanged(target, 'root', event.root);
    replaceIfChanged(target, 'quality', event.quality);
    replaceIfChanged(target, 'duration', event.duration);
}

function syncEvents(current: MutableRecord, events: readonly ChordEvent[]): void {
    const desired = new Map(events.map((event) => [event.id, event]));
    for (const [id, entity] of Object.entries(current)) {
        if (!desired.has(id) && isRecord(entity) && entity.deleted !== true) {
            entity.deleted = true;
        }
    }
    for (const [id, event] of desired) {
        const entity = current[id];
        if (!isRecord(entity) || !isRecord(entity.value)) {
            current[id] = { deleted: false, value: copyEvent(event) };
            continue;
        }
        replaceIfChanged(entity, 'deleted', false);
        syncEventValue(entity.value, event);
    }
}

function mutateCrdt({ doc, key, value }: { doc: MutableRecord; key: string; value: ChordTrackState }): void {
    const desired = normalizeState(value);
    const current = doc[key];
    assertSupportedSchema(current);
    if (!isCrdtState(current)) {
        doc[key] = encodeMigratedState(current, desired);
        return;
    }
    replaceIfChanged(current, 'enabled', desired.enabled);
    syncEvents(current.events, desired.events);
}

function mergeEntities(target: Record<string, ChordEventEntity>, source: Record<string, ChordEventEntity>): void {
    for (const id of Object.keys(source).sort(compareIds)) {
        const incoming = source[id]!;
        const existing = target[id];
        if (existing?.deleted !== true && (!existing || incoming.deleted === true)) {
            target[id] = structuredClone(incoming);
        }
    }
}

function reconcileRootConflicts(values: readonly unknown[]): ChordTrackCrdtState {
    const merged: ChordTrackCrdtState = {
        schemaVersion: CHORD_TRACK_CRDT_SCHEMA_VERSION,
        enabled: false,
        events: {},
    };
    for (const value of values) {
        assertSupportedSchema(value);
        const state = isCrdtState(value) ? value : encodeState(normalizeState(value));
        merged.enabled = state.enabled;
        mergeEntities(merged.events, state.events);
    }
    return merged;
}

function rebasePending({
    baseValue,
    pendingValue,
    hydratedValue,
}: {
    baseValue: ChordTrackState | null;
    pendingValue: ChordTrackState | null;
    hydratedValue: ChordTrackState;
}): ChordTrackState | null {
    if (!pendingValue) {
        return null;
    }
    const base = normalizeState(baseValue);
    const pending = normalizeState(pendingValue);
    const hydrated = normalizeState(hydratedValue);
    const baseById = new Map(base.events.map((event) => [event.id, event]));
    const pendingById = new Map(pending.events.map((event) => [event.id, event]));
    const rebasedById = new Map(hydrated.events.map((event) => [event.id, event]));
    for (const id of new Set([...baseById.keys(), ...pendingById.keys()])) {
        const local = pendingById.get(id);
        if (JSON.stringify(baseById.get(id)) === JSON.stringify(local)) {
            continue;
        }
        if (local) {
            rebasedById.set(id, local);
        } else {
            rebasedById.delete(id);
        }
    }
    return normalizeState({
        enabled: base.enabled === pending.enabled ? hydrated.enabled : pending.enabled,
        events: [...rebasedById.values()],
    });
}

export function createChordTrackAutomergeStorage() {
    let reconciledConflictState: ChordTrackCrdtState | null = null;
    return createAutomergeStorage<ChordTrackState>(DOC_PREFIX_ROOT, 'chordTrack', {
        fromCrdt: (value) => {
            reconciledConflictState = null;
            return decodeState(value);
        },
        hydrateMissing: () => defaultChordTrackState,
        resolveCrdtConflicts: (values) => {
            reconciledConflictState = reconcileRootConflicts(values);
            return decodeState(reconciledConflictState);
        },
        mutateCrdt: (input) => {
            if (!reconciledConflictState) {
                mutateCrdt(input);
                return;
            }
            const collapsed = structuredClone(reconciledConflictState);
            const desired = normalizeState(input.value);
            replaceIfChanged(collapsed, 'enabled', desired.enabled);
            syncEvents(collapsed.events, desired.events);
            input.doc[input.key] = collapsed;
            reconciledConflictState = null;
        },
        rebasePending,
    });
}

export const chordTrackStore = createStore<ChordTrackState>({
    storage: createChordTrackAutomergeStorage(),
    initialData: defaultChordTrackState,
});
