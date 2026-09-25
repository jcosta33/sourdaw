/**
 * Clip warp-marker store.
 *
 * Previously a bare module-level `Map<string, WarpState>` with no CRDT slot and
 * no subscription surface — warp markers vanished on save/reload, and an open
 * WaveformEditor only refreshed on clip switch or its own handlers. Now a
 * `Store<Record<clipId, WarpState>>` on the `warpStates` root slot, mirroring
 * `gainEnvelopeStore`.
 */
import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import {
    createWarpMarker,
    defaultWarpState,
    type WarpMarker,
    type WarpMarkerOrigin,
    type WarpState,
} from '../models/WarpMarker';

const DOC_PREFIX_ROOT = 'root';

export type WarpStateStoreState = {
    states: Record<string, WarpState>;
};

export const defaultWarpStateStoreState: WarpStateStoreState = { states: {} };

/** The stored entry for a clip id, or `undefined` when the clip carries none. */
export function getStoredWarpState(clipId: string): WarpState | undefined {
    return warpStateStore.value?.states[clipId];
}

export function getWarpState(clipId: string): WarpState {
    return getStoredWarpState(clipId) ?? defaultWarpState;
}

/**
 * Exhaustiveness anchor for `isDefaultWarpState`. `Record<keyof WarpState,
 * true>` forces every key of `WarpState` to appear as a property here — a
 * plain `state.someField` read below does not get this for free, since
 * TypeScript's excess-property check only fires on object literals assigned
 * to a typed slot, never on property reads off an already-typed parameter.
 * Add a field to `WarpState` without adding it here and this object literal
 * stops satisfying the annotation, so `pnpm typecheck` breaks at this line
 * until `isDefaultWarpState` below is updated to compare it too.
 */
export const warpStateFieldsCheckedByIsDefaultWarpState: Record<keyof WarpState, true> = {
    enabled: true,
    markers: true,
    stretchMode: true,
    originalTempo: true,
};

/**
 * Whether a `WarpState` value actually differs from `defaultWarpState`,
 * field by field. See `warpStateFieldsCheckedByIsDefaultWarpState` above for
 * the compile-time guarantee that a forgotten field cannot ship silently.
 */
export function isDefaultWarpState(state: WarpState): boolean {
    return (
        state.enabled === defaultWarpState.enabled &&
        state.markers.length === 0 &&
        state.stretchMode === defaultWarpState.stretchMode &&
        state.originalTempo === defaultWarpState.originalTempo
    );
}

/**
 * Whether a clip carries warp state a user actually added — not merely
 * whether the store has an entry for it. A write that leaves the state
 * value-identical to `defaultWarpState` is stored as absent (see
 * {@link setWarpState}), matching `readClipSatelliteEntry`.
 */
export function hasNonDefaultWarpState(clipId: string): boolean {
    const state = getStoredWarpState(clipId);
    return state !== undefined && !isDefaultWarpState(state);
}

/**
 * Replace the warp state for a clip. A value that is `isDefaultWarpState` is
 * stored as absent — the same rule `readClipSatelliteEntry` uses — so a
 * semantic no-op cannot become a satellite an undo guard treats as worth
 * keeping.
 */
export function setWarpState(clipId: string, state: WarpState): void {
    if (isDefaultWarpState(state)) {
        removeWarpState(clipId);
        return;
    }
    const current = warpStateStore.value ?? defaultWarpStateStoreState;
    warpStateStore.set({
        states: { ...current.states, [clipId]: state },
    });
}

/**
 * Drop the warp state keyed by a clip id. Called on clip removal so the store
 * doesn't retain entries for clips that no longer exist.
 */
export function removeWarpState(clipId: string): void {
    const current = warpStateStore.value ?? defaultWarpStateStoreState;
    if (!(clipId in current.states)) {
        return;
    }
    const { [clipId]: _removed, ...rest } = current.states;
    warpStateStore.set({ states: rest });
}

export function addWarpMarker(
    clipId: string,
    originalBeat: number,
    warpedBeat: number,
    options?: { origin?: WarpMarkerOrigin; confidence?: number; locked?: boolean }
): void {
    const current = getWarpState(clipId);
    const marker = createWarpMarker(originalBeat, warpedBeat, options);
    setWarpState(clipId, {
        ...current,
        markers: [...current.markers, marker].sort((alpha, buffer) => alpha.originalBeat - buffer.originalBeat),
    });
}

/** Replace every warp state at once — the project-load entry point. */
export function setAllWarpStates(states: Record<string, WarpState>): void {
    const sanitized: Record<string, WarpState> = {};
    for (const [clipId, state] of Object.entries(states)) {
        if (!isDefaultWarpState(state)) {
            sanitized[clipId] = state;
        }
    }
    warpStateStore.set({ states: sanitized });
}

export function getAllWarpStates(): Array<WarpState & { clipId: string }> {
    const current = warpStateStore.value;
    if (!current) {
        return [];
    }
    return Object.entries(current.states).map(([clipId, state]) => ({ clipId, ...state }));
}

const WARP_STRETCH_MODES = new Set(['repitch', 'complex', 'texture', 'beats']);
const WARP_MARKER_ORIGINS = new Set(['user', 'transient-auto', 'grid-snap']);

const WARP_MARKER_KEYS = ['id', 'originalBeat', 'warpedBeat', 'origin', 'confidence', 'locked'] as const;
const WARP_STATE_KEYS = ['enabled', 'markers', 'stretchMode', 'originalTempo'] as const;

function hasFiniteNumberField(value: object, key: string): boolean {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'number' && Number.isFinite(field);
}

function hasValidOptionalWarpMarkerFields(value: object): boolean {
    if (
        'origin' in value &&
        value.origin !== undefined &&
        (typeof value.origin !== 'string' || !WARP_MARKER_ORIGINS.has(value.origin))
    ) {
        return false;
    }
    if (
        'confidence' in value &&
        value.confidence !== undefined &&
        (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence))
    ) {
        return false;
    }
    if ('locked' in value && value.locked !== undefined && typeof value.locked !== 'boolean') {
        return false;
    }
    return true;
}

function isWarpMarker(value: unknown): value is WarpState['markers'][number] {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (!hasFiniteNumberField(value, 'originalBeat') || !hasFiniteNumberField(value, 'warpedBeat')) {
        return false;
    }
    if (!hasValidOptionalWarpMarkerFields(value)) {
        return false;
    }
    return Object.keys(value).every((key) => (WARP_MARKER_KEYS as readonly string[]).includes(key));
}

function isWarpState(value: unknown): value is WarpState {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('enabled' in value) || typeof value.enabled !== 'boolean') {
        return false;
    }
    if (!('markers' in value) || !Array.isArray(value.markers) || !value.markers.every(isWarpMarker)) {
        return false;
    }
    if (
        !('stretchMode' in value) ||
        typeof value.stretchMode !== 'string' ||
        !WARP_STRETCH_MODES.has(value.stretchMode)
    ) {
        return false;
    }
    if (
        !('originalTempo' in value) ||
        !(
            value.originalTempo === null ||
            (typeof value.originalTempo === 'number' && Number.isFinite(value.originalTempo))
        )
    ) {
        return false;
    }
    return Object.keys(value).every((key) => (WARP_STATE_KEYS as readonly string[]).includes(key));
}

type ClipWarpStateRecord = WarpState & { clipId: string };

function isClipWarpStateRecord(value: unknown): value is ClipWarpStateRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('clipId' in value) || typeof value.clipId !== 'string' || value.clipId.length === 0) {
        return false;
    }
    const { clipId: _clipId, ...rest } = value as { clipId: string } & Record<string, unknown>;
    return isWarpState(rest);
}

/** Copy a marker field by field, omitting undefined optional keys (same shape as `normalizeWarpMarker`). */
function copySanitizedWarpMarker(marker: WarpMarker): WarpMarker {
    const copied: WarpMarker = {
        id: marker.id,
        originalBeat: marker.originalBeat,
        warpedBeat: marker.warpedBeat,
    };
    if (marker.origin !== undefined) {
        copied.origin = marker.origin;
    }
    if (marker.confidence !== undefined) {
        copied.confidence = marker.confidence;
    }
    if (marker.locked !== undefined) {
        copied.locked = marker.locked;
    }
    return copied;
}

/**
 * Decode persisted clip warp states from a project file into the store's
 * `clipId`-keyed shape. A row that does not decode, or that is default, is
 * dropped: the clip then plays without warp markers.
 */
export function sanitizeClipWarpStates(value: unknown): Record<string, WarpState> {
    if (!Array.isArray(value)) {
        return {};
    }

    const states: Record<string, WarpState> = {};
    for (const candidate of value) {
        if (!isClipWarpStateRecord(candidate)) {
            continue;
        }
        const state: WarpState = {
            enabled: candidate.enabled,
            markers: candidate.markers.map(copySanitizedWarpMarker),
            stretchMode: candidate.stretchMode,
            originalTempo: candidate.originalTempo,
        };
        if (!isDefaultWarpState(state)) {
            states[candidate.clipId] = state;
        }
    }
    return states;
}

function isExactWarpState(value: unknown): value is WarpState {
    if (!isWarpState(value)) {
        return false;
    }
    return value.markers.every((marker) => {
        const keys = Object.keys(marker);
        return keys.every((key) => (WARP_MARKER_KEYS as readonly string[]).includes(key));
    });
}

function isExactWarpStateStoreState(value: unknown): value is WarpStateStoreState {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'states') {
        return false;
    }
    if (!('states' in value) || value.states === null || typeof value.states !== 'object') {
        return false;
    }
    if (Array.isArray(value.states)) {
        return false;
    }
    return Object.values(value.states).every((state) => isExactWarpState(state) && !isDefaultWarpState(state));
}

/**
 * Store-shaped decoder for the `warpStates` document slot.
 *
 * The file path decodes an array through {@link sanitizeClipWarpStates}; the
 * document holds the same states already keyed by clip id. Returns the
 * argument itself when it already decodes exactly, so `createStore` does not
 * write a sanitized copy back over a shared document.
 */
function sanitizeWarpStateStoreState(value: unknown): WarpStateStoreState {
    if (isExactWarpStateStoreState(value)) {
        return value;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !('states' in value)) {
        return { states: {} };
    }
    const source = value.states;
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
        return { states: {} };
    }
    const states: Record<string, WarpState> = {};
    for (const [clipId, candidate] of Object.entries(source)) {
        if (typeof clipId !== 'string' || clipId.length === 0 || !isWarpState(candidate)) {
            continue;
        }
        if (isDefaultWarpState(candidate)) {
            continue;
        }
        states[clipId] = {
            enabled: candidate.enabled,
            markers: candidate.markers.map(copySanitizedWarpMarker),
            stretchMode: candidate.stretchMode,
            originalTempo: candidate.originalTempo,
        };
    }
    return { states };
}

export const warpStateStore = createStore<WarpStateStoreState>({
    storage: createAutomergeStorage<WarpStateStoreState>(DOC_PREFIX_ROOT, 'warpStates', {
        // A document without the `warpStates` slot resets the store to empty
        // rather than back-writing this replica's cache (audit CC-2). Warp
        // states are keyed by clip id, which is not unique across projects, so
        // a stale entry would attach to an unrelated clip in the incoming
        // project.
        hydrateMissing: () => ({ states: {} }),
    }),
    initialData: defaultWarpStateStoreState,
    sanitize: sanitizeWarpStateStoreState,
});

/**
 * Test-only: reset the store to its empty default.
 *
 * Guarded behind `import.meta.env.MODE` so it cannot mutate the live store in a
 * production build — under Vitest `MODE` is `'test'`.
 */
export function __resetWarpStatesForTest(): void {
    if (import.meta.env.MODE !== 'test') {
        return;
    }
    warpStateStore.set(defaultWarpStateStoreState);
}

/**
 * Map-shaped read/write surface over {@link warpStateStore}. Kept so existing
 * callers and specs that used the old module-level `Map` keep compiling; every
 * mutating method ends in {@link setWarpState} / {@link removeWarpState}, so
 * there is no second persistence path.
 */
export const warpStates = {
    get(clipId: string): WarpState | undefined {
        return getStoredWarpState(clipId);
    },
    set(clipId: string, state: WarpState): void {
        setWarpState(clipId, state);
    },
    has(clipId: string): boolean {
        return getStoredWarpState(clipId) !== undefined;
    },
    delete(clipId: string): boolean {
        const existed = getStoredWarpState(clipId) !== undefined;
        removeWarpState(clipId);
        return existed;
    },
    clear(): void {
        warpStateStore.set(defaultWarpStateStoreState);
    },
    get size(): number {
        return Object.keys(warpStateStore.value?.states ?? {}).length;
    },
    entries(): IterableIterator<[string, WarpState]> {
        return Object.entries(warpStateStore.value?.states ?? {})[Symbol.iterator]() as IterableIterator<
            [string, WarpState]
        >;
    },
    [Symbol.iterator](): IterableIterator<[string, WarpState]> {
        return this.entries();
    },
};
