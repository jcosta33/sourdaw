/**
 * Grinder drum machine state store.
 * Holds the current kit, selected pad, sequencer state, and UI level.
 * Reactive — UI subscribes via useStore from #/infra/store/useStore.
 */

import { createStore } from '#/infra/store/createStore';

import { type ToasterKit, type PadState, createDefaultKit } from '../models/ToasterKit';

export type MorphState = {
    enabled: boolean;
    targetPatternId: string | null;
    position: number;
};

export type ToasterState = {
    kit: ToasterKit;
    selectedPadIndex: number;
    isPlaying: boolean;
    currentStep: number;
    uiLevel: 1 | 2 | 3 | 4 | 5;
    engineReady: boolean;
    activeVoices: number;
    morph: MorphState;
};

export const defaultToasterState: ToasterState = {
    kit: createDefaultKit(),
    selectedPadIndex: 0,
    isPlaying: false,
    currentStep: 0,
    uiLevel: 1,
    engineReady: false,
    activeVoices: 0,
    morph: { enabled: false, targetPatternId: null, position: 0 },
};

type ToasterInstances = Record<string, ToasterState>;

export const toasterStore = createStore<ToasterInstances>({
    initialData: {},
});

// Kit-param writes that arrive before the device is registered. The panel mounts
// as soon as the device sits on its track, but the store record is created only
// when `audioDevice.loaded` fires (the WASM node finishing its async load), so a
// knob drag in that window reaches `updateKit` with no record to write. The
// engine side of that same write is already deferred — the loading placeholder's
// `setParam` buffers into `pendingParams`, which the loader replays
// (AudioEngine/engine/wasmDeviceRegistry.ts) — and the store defers it here the
// same way instead of discarding it. Registration creates the record and then
// flushes these updates on top, as a separate store write so kit-identity
// persistence records it as an edit rather than first sight.
const pendingKitUpdates = new Map<string, Partial<ToasterKit>>();

// Ids torn down by `unregisterToasterDevice`. A write arriving after teardown
// must not reach the device's next reload: a reload rehydrates project truth,
// and a stale queued write would corrupt it. Only never-seen ids may queue.
const retiredDeviceIds = new Set<string>();

/**
 * The single creation point for a Toaster instance record.
 *
 * Every mutator below refuses an unknown deviceId so a write arriving after
 * teardown cannot resurrect a deleted device. That guard is only safe because
 * registration — not a stray write — is what puts the record here. Removing
 * this function does not "fall back" to anything: the store stays empty and
 * every panel edit, step toggle and kit load becomes a silent no-op.
 *
 * Idempotent: re-registering a device that already has a record keeps that
 * record, so a reload never discards the edits it is holding.
 *
 * Each device gets its own kit object rather than sharing
 * `defaultToasterState.kit`, so no two instances can ever alias the same
 * pads/patterns arrays.
 */
export function registerToasterDevice(deviceId: string, initialKit?: ToasterKit): void {
    // A registration means the device is live again: post-teardown refusal ends
    // here, and writes go straight to the record from now on.
    retiredDeviceIds.delete(deviceId);
    const instances = toasterStore.value ?? {};
    if (instances[deviceId]) {
        return;
    }
    // `initialKit` is the kit project truth already holds for this device. Taking it
    // here rather than loading it in a second write matters: the record is created
    // holding its saved kit, so nothing ever observes this device carrying a default
    // kit it did not have, and a load produces no store change that looks like an edit.
    toasterStore.set({ ...instances, [deviceId]: { ...defaultToasterState, kit: initialKit ?? createDefaultKit() } });

    // Kit edits the user made while the device was still loading land here, on
    // top of the registration kit. Applied through `updateKit` (record now
    // exists) rather than merged into the create above, so the store emits a
    // second kit identity and persistence commits the edit.
    const pending = pendingKitUpdates.get(deviceId);
    if (!pending) {
        return;
    }
    pendingKitUpdates.delete(deviceId);
    updateKit(deviceId, pending);
}

export function unregisterToasterDevice(deviceId: string): void {
    const state = toasterStore.value;
    if (state && state[deviceId]) {
        const next = { ...state };
        delete next[deviceId];
        toasterStore.set(next);
        // Drop anything queued while this device was loading and refuse writes
        // from here on: this id's next registration rehydrates project truth,
        // which a stale write must not touch.
        pendingKitUpdates.delete(deviceId);
        retiredDeviceIds.add(deviceId);
    }
}

export function selectPad(deviceId: string, index: number): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId];
    // Unknown deviceId → no-op; selecting a pad must not resurrect a torn-down device.
    if (!state) {
        return;
    }
    if (index >= 0 && index < state.kit.pads.length) {
        toasterStore.set({ ...instances, [deviceId]: { ...state, selectedPadIndex: index } });
    }
}

export function updatePad(deviceId: string, index: number, updates: Partial<PadState>): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId];
    // Do not synthesize a default record for an unknown deviceId: a param
    // write arriving after teardown must not resurrect a deleted device.
    if (!state) {
        return;
    }
    const pads = [...state.kit.pads];
    if (!pads[index]) {
        return;
    }
    pads[index] = { ...pads[index], ...updates };
    toasterStore.set({ ...instances, [deviceId]: { ...state, kit: { ...state.kit, pads } } });
}

export function loadKit(deviceId: string, kit: ToasterKit): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId];
    // Unknown deviceId → no-op; loading a kit must not recreate a torn-down device.
    if (!state) {
        return;
    }
    toasterStore.set({ ...instances, [deviceId]: { ...state, kit, selectedPadIndex: 0 } });
}

export function updateKit(deviceId: string, updates: Partial<ToasterKit>): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId];
    // Unknown deviceId → refused for a torn-down device, deferred for one still
    // loading; see the queueing rationale just below.
    if (!state) {
        // No record. A torn-down device stays refused — queueing a post-teardown
        // write would let it reach the id's next reload, which rehydrates
        // project truth. A device still loading (panel mounted, registration
        // not yet fired) gets the write deferred until registration creates the
        // record, mirroring the engine placeholder's `pendingParams` deferral
        // of the same write instead of discarding it.
        if (!retiredDeviceIds.has(deviceId)) {
            const pending = pendingKitUpdates.get(deviceId);
            pendingKitUpdates.set(deviceId, { ...pending, ...updates });
        }
        return;
    }

    toasterStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            kit: {
                ...state.kit,
                ...updates,
            },
        },
    });
}

export function toggleStep(deviceId: string, padIndex: number, stepIndex: number): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId];
    // Unknown deviceId → no-op; a step toggle must not resurrect a torn-down device.
    if (!state) {
        return;
    }
    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }
    const track = pattern.tracks.find((time) => time.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return;
    }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = { ...newSteps[stepIndex]!, active: !newSteps[stepIndex]!.active };

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({ ...instances, [deviceId]: { ...state, kit: { ...state.kit, patterns: newPatterns } } });
}

export function setStepVelocity(deviceId: string, padIndex: number, stepIndex: number, velocity: number): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId];
    // Unknown deviceId → no-op; a velocity write must not resurrect a torn-down device.
    if (!state) {
        return;
    }
    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }
    const track = pattern.tracks.find((time) => time.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return;
    }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = { ...newSteps[stepIndex]!, velocity: Math.max(0, Math.min(1, velocity)) };

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({ ...instances, [deviceId]: { ...state, kit: { ...state.kit, patterns: newPatterns } } });
}
