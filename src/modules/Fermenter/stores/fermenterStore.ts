/**
 * Fermenter synth state store.
 * Holds the current patch and UI state. Reactive — UI subscribes via useStore from #/infra/store/useStore.
 * Keyed by deviceId to support multiple simultaneous instances.
 */

import { createStore } from '#/infra/store/createStore';

import { type FermenterPatch, DEFAULT_PATCH } from '../models/FermenterPatch';

export type FermenterState = {
    patch: FermenterPatch;
    activeVoices: number;
    engineReady: boolean;
    uiLevel: 1 | 2 | 3 | 4 | 5;
    /** Peak output levels for meters (updated from worklet) */
    peakL: number;
    peakR: number;
    /** Scope buffer (last 128 samples for oscilloscope) */
    scopeBuffer: Float32Array | null;
};

export const DEFAULT_FERMENTER_STATE: FermenterState = {
    patch: DEFAULT_PATCH,
    activeVoices: 0,
    engineReady: false,
    uiLevel: 2,
    peakL: 0,
    peakR: 0,
    scopeBuffer: null,
};

type FermenterInstances = Record<string, FermenterState>;

export const fermenterStore = createStore<FermenterInstances>({ initialData: {} });

export function getFermenterState(deviceId: string): FermenterState {
    return (fermenterStore.value ?? {})[deviceId] ?? DEFAULT_FERMENTER_STATE;
}

export function setFermenterParam(deviceId: string, key: keyof FermenterPatch, value: number): void {
    const instances = fermenterStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_FERMENTER_STATE, patch: { ...DEFAULT_PATCH } };
    fermenterStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, [key]: value } } });
}

export function setFermenterUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): void {
    const instances = fermenterStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_FERMENTER_STATE, patch: { ...DEFAULT_PATCH } };
    fermenterStore.set({ ...instances, [deviceId]: { ...state, uiLevel: level } });
}

export function loadFermenterPatch(deviceId: string, patch: FermenterPatch): void {
    const instances = fermenterStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_FERMENTER_STATE, patch: { ...DEFAULT_PATCH } };
    fermenterStore.set({ ...instances, [deviceId]: { ...state, patch } });
}

const telemetryQueue = new Map<string, { peakL: number; peakR: number; scopeBuffer: Float32Array }>();
let telemetryRafId: number | null = null;

function flushFermenterTelemetry() {
    telemetryRafId = null;
    if (telemetryQueue.size === 0) {
        return;
    }

    const instances = fermenterStore.value ?? {};
    let changed = false;
    const newInstances = { ...instances };

    for (const [deviceId, data] of telemetryQueue.entries()) {
        const state = instances[deviceId] ?? { ...DEFAULT_FERMENTER_STATE, patch: { ...DEFAULT_PATCH } };
        newInstances[deviceId] = { ...state, peakL: data.peakL, peakR: data.peakR, scopeBuffer: data.scopeBuffer };
        changed = true;
    }

    if (changed) {
        fermenterStore.set(newInstances);
    }
    telemetryQueue.clear();
}

export function setFermenterTelemetry(deviceId: string, peakL: number, peakR: number, scopeBuffer: Float32Array): void {
    telemetryQueue.set(deviceId, { peakL, peakR, scopeBuffer });
    if (telemetryRafId === null) {
        if (typeof requestAnimationFrame !== 'undefined') {
            telemetryRafId = requestAnimationFrame(flushFermenterTelemetry);
        } else {
            telemetryRafId = setTimeout(flushFermenterTelemetry, 16) as unknown as number;
        }
    }
}
