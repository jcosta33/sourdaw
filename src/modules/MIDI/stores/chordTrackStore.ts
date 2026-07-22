import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { type ChordEvent } from '../models/ChordEvent';
import { CHORD_TYPES, type ChordType } from '../models/ChordTypes';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

export const defaultChordTrackState: ChordTrackState = { enabled: false, events: [] };

const CHORD_TRACK_CRDT_SCHEMA_VERSION = 1;
const CHORD_EVENT_VALUE_FIELDS = ['beat', 'root', 'quality', 'duration'] as const;

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
        value.id.length > 0 &&
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

    if (typeof value.enabled !== 'boolean' || !Array.isArray(value.events) || !value.events.every(isChordEvent)) {
        return false;
    }
    return new Set(value.events.map((event) => event.id)).size === value.events.length;
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
    if (
        !isRecord(value) ||
        value.schemaVersion !== CHORD_TRACK_CRDT_SCHEMA_VERSION ||
        typeof value.enabled !== 'boolean' ||
        !isRecord(value.events)
    ) {
        return false;
    }
    return Object.entries(value.events).every(
        ([id, entity]) =>
            id.length > 0 &&
            isRecord(entity) &&
            typeof entity.deleted === 'boolean' &&
            isChordEvent(entity.value) &&
            entity.value.id === id
    );
}

function assertSupportedSchema(value: unknown): void {
    if (!isRecord(value) || !Object.hasOwn(value, 'schemaVersion')) {
        return;
    }
    if (value.schemaVersion !== CHORD_TRACK_CRDT_SCHEMA_VERSION) {
        throw new Error(`Unsupported chord-track CRDT schema version: ${String(value.schemaVersion)}`);
    }
    if (!isCrdtState(value)) {
        throw new Error(`Malformed chord-track CRDT schema version ${CHORD_TRACK_CRDT_SCHEMA_VERSION}`);
    }
}

function encodeState(value: ChordTrackState): ChordTrackCrdtState {
    const state = normalizeState(value);
    return {
        schemaVersion: CHORD_TRACK_CRDT_SCHEMA_VERSION,
        enabled: state.enabled,
        events: Object.fromEntries(state.events.map((event) => [event.id, { deleted: false, value: { ...event } }])),
    };
}

function decodeState(value: unknown): ChordTrackState {
    assertSupportedSchema(value);
    if (!isCrdtState(value)) {
        return normalizeState(value);
    }
    const events = Object.values(value.events).flatMap((entity) => (entity.deleted ? [] : [entity.value]));
    return normalizeState({ enabled: value.enabled, events });
}

function replaceIfChanged(target: MutableRecord, key: string, value: unknown): void {
    if (JSON.stringify(target[key]) !== JSON.stringify(value)) {
        target[key] = value;
    }
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
            current[id] = { deleted: false, value: { ...event } };
            continue;
        }
        replaceIfChanged(entity, 'deleted', false);
        replaceIfChanged(entity.value, 'id', event.id);
        for (const field of CHORD_EVENT_VALUE_FIELDS) {
            replaceIfChanged(entity.value, field, event[field]);
        }
    }
}

function mutateCrdt({ doc, key, value }: { doc: MutableRecord; key: string; value: ChordTrackState }): void {
    const desired = normalizeState(value);
    const current = doc[key];
    assertSupportedSchema(current);
    if (!isCrdtState(current)) {
        doc[key] = encodeState(desired);
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

function mergeEventFields(base: ChordEvent, values: readonly ChordEvent[]): ChordEvent {
    const merged = { ...base };
    for (const event of values) {
        for (const field of CHORD_EVENT_VALUE_FIELDS) {
            if (event[field] !== base[field]) {
                Object.assign(merged, { [field]: event[field] });
            }
        }
    }
    return merged;
}

function reconcileRootConflicts(values: readonly unknown[]): ChordTrackCrdtState {
    const merged = encodeState(defaultChordTrackState);
    for (const value of values) {
        assertSupportedSchema(value);
        const state = isCrdtState(value) ? value : encodeState(normalizeState(value));
        merged.enabled = state.enabled;
        mergeEntities(merged.events, state.events);
    }
    return merged;
}

type RebasePendingInput = {
    baseValue: ChordTrackState | null;
    pendingValue: ChordTrackState | null;
    hydratedValue: ChordTrackState;
};

function rebasePending({ baseValue, pendingValue, hydratedValue }: RebasePendingInput): ChordTrackState | null {
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
        const original = baseById.get(id);
        const local = pendingById.get(id);
        const remote = rebasedById.get(id);
        if (JSON.stringify(original) === JSON.stringify(local)) {
            continue;
        }
        // Existing-event deletion wins over a concurrent update in either direction.
        if (original && (!local || !remote)) {
            rebasedById.delete(id);
            continue;
        }
        if (original && local && remote) {
            rebasedById.set(id, mergeEventFields(original, [remote, local]));
            continue;
        }
        if (local) {
            rebasedById.set(id, local);
        }
    }
    return normalizeState({
        enabled: base.enabled === pending.enabled ? hydrated.enabled : pending.enabled,
        events: [...rebasedById.values()],
    });
}

export function createChordTrackAutomergeStorage() {
    let reconciledConflictState: ChordTrackCrdtState | null = null;
    return createAutomergeStorage<ChordTrackState>('root', 'chordTrack', {
        fromCrdt: (value) => {
            reconciledConflictState = null;
            return decodeState(value);
        },
        hydrateMissing: () => {
            reconciledConflictState = null;
            return defaultChordTrackState;
        },
        resolveCrdtConflicts: (values) => {
            reconciledConflictState = reconcileRootConflicts(values);
            return decodeState(reconciledConflictState);
        },
        mutateCrdt: (input) => {
            if (reconciledConflictState) {
                input.doc[input.key] = structuredClone(reconciledConflictState);
            }
            reconciledConflictState = null;
            mutateCrdt(input);
        },
        rebasePending,
    });
}

export const chordTrackStore = createStore<ChordTrackState>({
    storage: createChordTrackAutomergeStorage(),
    initialData: defaultChordTrackState,
});
