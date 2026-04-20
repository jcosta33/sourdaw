/**
 * Reactive state for the Grinder amp simulator.
 * Keyed by deviceId to support multiple simultaneous instances.
 */
import { createStore } from '#/infra/store/createStore';

import {
    type GrinderMic,
    type GrinderPatch,
    type GrinderPedal,
    type GrinderPedalType,
    DEFAULT_PATCH,
    migrateGrinderPatch,
} from '../models/GrinderPatch';

import { updateGrinderTelemetry } from './grinderTelemetryStore';

export type GrinderState = {
    patch: GrinderPatch;
};

export const DEFAULT_GRINDER_STATE: GrinderState = {
    patch: DEFAULT_PATCH,
};

type GrinderInstances = Record<string, GrinderState>;

export const grinderStore = createStore<GrinderInstances>({ initialData: {} });

export function getGrinderState(deviceId: string): GrinderState {
    return grinderStore.value?.[deviceId] ?? { ...DEFAULT_GRINDER_STATE, patch: { ...DEFAULT_PATCH } };
}

export function setGrinderParam<K extends keyof GrinderPatch>(deviceId: string, key: K, value: GrinderPatch[K]): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GRINDER_STATE, patch: { ...DEFAULT_PATCH } };
    grinderStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, [key]: value } } });
}

export function loadGrinderPatch(deviceId: string, patch: GrinderPatch): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_GRINDER_STATE, patch: { ...DEFAULT_PATCH } };
    grinderStore.set({ ...instances, [deviceId]: { ...state, patch: migrateGrinderPatch(patch) } });
}

export function replaceGrinderPatchLocally(deviceId: string, patch: GrinderPatch): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId];
    if (!state) {
        return;
    }
    grinderStore.set({ ...instances, [deviceId]: { ...state, patch: migrateGrinderPatch(patch) } });
}

export function upsertPedal(
    pedals: readonly GrinderPedal[],
    type: GrinderPedalType,
    defaults: GrinderPedal,
    update: (pedal: GrinderPedal) => GrinderPedal
): GrinderPedal[] {
    const existing = pedals.find((pedal) => pedal.type === type);
    if (!existing) {
        return [...pedals, update(defaults)];
    }
    return pedals.map((pedal) => (pedal.type === type ? update(pedal) : pedal));
}

export function setGrinderPedalParam(
    deviceId: string,
    isPost: boolean,
    pedalType: GrinderPedalType,
    paramKey: string,
    value: number,
    defaults: GrinderPedal
): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId];
    if (!state) {
        return;
    }

    const chainKey = isPost ? 'postPedals' : 'prePedals';
    const nextPedals = upsertPedal(state.patch[chainKey], pedalType, defaults, (current) => ({
        ...current,
        params: { ...current.params, [paramKey]: value },
    }));

    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: { ...state.patch, [chainKey]: nextPedals },
        },
    });
}

export function setGrinderMicParam<K extends keyof GrinderMic>(
    deviceId: string,
    micIndex: 1 | 2,
    key: K,
    value: GrinderMic[K]
): void {
    const instances = grinderStore.value ?? {};
    const state = instances[deviceId];
    if (!state) {
        return;
    }

    const micKey = micIndex === 1 ? 'mic1' : 'mic2';
    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: {
                ...state.patch,
                [micKey]: { ...state.patch[micKey], [key]: value },
            },
        },
    });
}

export function updateGrinderMeters(deviceId: string, meters: any): void {
    updateGrinderTelemetry(deviceId, meters);
}
