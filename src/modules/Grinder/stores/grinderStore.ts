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
    isSupportedGrinderChainPedalType,
    migrateGrinderPatch,
} from '../models/GrinderPatch';

import { updateGrinderTelemetry, type GrinderTelemetry } from './grinderTelemetryStore';

export type GrinderState = {
    patch: GrinderPatch;
    basePatch: GrinderPatch;
};

export const DEFAULT_GRINDER_STATE: GrinderState = {
    patch: DEFAULT_PATCH,
    basePatch: DEFAULT_PATCH,
};

type GrinderInstances = Record<string, GrinderState>;

export const grinderStore = createStore<GrinderInstances>({ initialData: {} });

function createDefaultGrinderState(): GrinderState {
    const patch = migrateGrinderPatch(DEFAULT_PATCH);
    return {
        patch,
        basePatch: migrateGrinderPatch(patch),
    };
}

function normalizeGrinderState(state: Partial<GrinderState> | undefined): GrinderState {
    if (!state) {
        return createDefaultGrinderState();
    }

    const patch = migrateGrinderPatch(state.patch ?? DEFAULT_PATCH);
    const basePatch = migrateGrinderPatch(state.basePatch ?? patch);

    return {
        patch,
        basePatch,
    };
}

export function getGrinderState(deviceId: string): GrinderState {
    return normalizeGrinderState(grinderStore.value?.[deviceId]);
}

export function setGrinderParam<Key extends keyof GrinderPatch>(
    deviceId: string,
    key: Key,
    value: GrinderPatch[Key]
): void {
    const instances = grinderStore.value ?? {};
    const state = normalizeGrinderState(instances[deviceId]);
    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: { ...state.patch, [key]: value },
            basePatch: { ...state.basePatch, [key]: value },
        },
    });
}

export function loadGrinderPatch(deviceId: string, patch: GrinderPatch): void {
    const instances = grinderStore.value ?? {};
    const state = normalizeGrinderState(instances[deviceId]);
    const migrated_patch = migrateGrinderPatch(patch);
    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: migrated_patch,
            basePatch: migrateGrinderPatch(migrated_patch),
        },
    });
}

export function replaceGrinderPatchLocally(deviceId: string, patch: GrinderPatch): void {
    const instances = grinderStore.value ?? {};
    const state = normalizeGrinderState(instances[deviceId]);

    const migrated_patch = migrateGrinderPatch(patch);
    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: migrated_patch,
            basePatch: migrateGrinderPatch(migrated_patch),
        },
    });
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
    const state = normalizeGrinderState(instances[deviceId]);

    const chainKey = isPost ? 'postPedals' : 'prePedals';
    const nextPedals = upsertPedal(state.patch[chainKey], pedalType, defaults, (current) => ({
        ...current,
        ...(paramKey === 'enabled'
            ? { enabled: value > 0.5 }
            : { params: { ...current.params, [paramKey]: value } }),
    }));
    const nextBasePedals = upsertPedal(state.basePatch[chainKey], pedalType, defaults, (current) => ({
        ...current,
        ...(paramKey === 'enabled'
            ? { enabled: value > 0.5 }
            : { params: { ...current.params, [paramKey]: value } }),
    }));

    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: { ...state.patch, [chainKey]: nextPedals },
            basePatch: { ...state.basePatch, [chainKey]: nextBasePedals },
        },
    });
}

export function setGrinderMicParam<Key extends keyof GrinderMic>(
    deviceId: string,
    micIndex: 1 | 2,
    key: Key,
    value: GrinderMic[Key]
): void {
    const instances = grinderStore.value ?? {};
    const state = normalizeGrinderState(instances[deviceId]);

    const micKey = micIndex === 1 ? 'mic1' : 'mic2';
    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: {
                ...state.patch,
                [micKey]: { ...state.patch[micKey], [key]: value },
            },
            basePatch: {
                ...state.basePatch,
                [micKey]: { ...state.basePatch[micKey], [key]: value },
            },
        },
    });
}

function movePedalTypeInArray(
    pedals: readonly GrinderPedal[],
    pedalType: GrinderPedalType,
    direction: 'left' | 'right'
): GrinderPedal[] {
    const current_index = pedals.findIndex((pedal) => pedal.type === pedalType);
    if (current_index < 0) {
        return [...pedals];
    }

    const range = direction === 'left'
        ? [...pedals.keys()].slice(0, current_index).reverse()
        : [...pedals.keys()].slice(current_index + 1);
    const swap_index = range.find((index) => isSupportedGrinderChainPedalType(pedals[index]!.type));

    if (swap_index === undefined) {
        return [...pedals];
    }

    const next_pedals = [...pedals];
    const current = next_pedals[current_index];
    next_pedals[current_index] = next_pedals[swap_index]!;
    next_pedals[swap_index] = current!;
    return next_pedals;
}

export function moveGrinderPedalInChain(
    deviceId: string,
    isPost: boolean,
    pedalType: GrinderPedalType,
    direction: 'left' | 'right'
): GrinderPatch | null {
    const instances = grinderStore.value ?? {};
    const state = normalizeGrinderState(instances[deviceId]);
    const chainKey = isPost ? 'postPedals' : 'prePedals';

    const nextPedals = movePedalTypeInArray(state.patch[chainKey], pedalType, direction);
    const nextBasePedals = movePedalTypeInArray(state.basePatch[chainKey], pedalType, direction);

    const nextPatch = { ...state.patch, [chainKey]: nextPedals };
    const nextBasePatch = { ...state.basePatch, [chainKey]: nextBasePedals };

    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: nextPatch,
            basePatch: nextBasePatch,
        },
    });

    return nextPatch;
}

function applySnapshotToPedals(
    pedals: readonly GrinderPedal[],
    bypassStates: Record<string, boolean>
): GrinderPedal[] {
    return pedals.map((pedal) =>
        pedal.id in bypassStates ? { ...pedal, enabled: bypassStates[pedal.id] ?? pedal.enabled } : pedal
    );
}

export function recallGrinderSnapshot(deviceId: string, snapshotIndex: number): GrinderPatch | null {
    const instances = grinderStore.value ?? {};
    const state = normalizeGrinderState(instances[deviceId]);
    const snapshot = state.basePatch.snapshots[snapshotIndex];

    if (!snapshot) {
        return null;
    }

    const nextPatch: GrinderPatch = {
        ...state.basePatch,
        activeSnapshot: snapshotIndex,
        prePedals: applySnapshotToPedals(state.basePatch.prePedals, snapshot.bypassStates),
        postPedals: applySnapshotToPedals(state.basePatch.postPedals, snapshot.bypassStates),
    };

    for (const [key, value] of Object.entries(snapshot.paramOverrides)) {
        if (key in nextPatch) {
            nextPatch[key as keyof GrinderPatch] = value as never;
        }
    }

    grinderStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            patch: nextPatch,
            basePatch: {
                ...state.basePatch,
                activeSnapshot: snapshotIndex,
            },
        },
    });

    return nextPatch;
}

export function updateGrinderMeters(deviceId: string, meters: Partial<GrinderTelemetry>): void {
    updateGrinderTelemetry(deviceId, meters);
}
