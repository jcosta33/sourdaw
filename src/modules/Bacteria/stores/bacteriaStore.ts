/**
 * Reactive state for the Bacteria creative multi-effects processor.
 * Keyed by deviceId to support multiple simultaneous instances.
 */
import { createStore } from '#/infra/store/createStore';
import { type BacteriaPatch, DEFAULT_PATCH } from '../models/BacteriaPatch';

export type BacteriaUiLevel = 1 | 2 | 3 | 4 | 5;

export type BacteriaState = {
    patch: BacteriaPatch;
    inputDb: number;
    outputDb: number;
    /** Per-band RMS levels (up to 6 bands) */
    bandLevels: number[];
    latency: number;
    /** Currently selected band index in the UI */
    activeBand: number;
    /** Progressive disclosure level: 1=Play, 2=Shape, 3=Build, 4=Route, 5=Lab */
    uiLevel: BacteriaUiLevel;
    /** Currently selected effect module in Shape mode */
    activeModule: string;
};

export const DEFAULT_BACTERIA_STATE: BacteriaState = {
    patch: DEFAULT_PATCH,
    inputDb: -100,
    outputDb: -100,
    bandLevels: [0, 0, 0, 0, 0, 0],
    latency: 0,
    activeBand: 0,
    uiLevel: 1,
    activeModule: 'distortion',
};

type BacteriaInstances = Record<string, BacteriaState>;

export const bacteriaStore = createStore<BacteriaInstances>({ initialData: {} });

export function getBacteriaState(deviceId: string): BacteriaState {
    return bacteriaStore.value?.[deviceId] ?? { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH } };
}

export function setBacteriaParam<K extends keyof BacteriaPatch>(
    deviceId: string,
    key: K,
    value: BacteriaPatch[K]
): void {
    const instances = bacteriaStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH } };
    bacteriaStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, [key]: value } } });
}

export function setBacteriaBandParam<K extends keyof BacteriaPatch['bands'][0]>(
    deviceId: string,
    bandIndex: number,
    key: K,
    value: BacteriaPatch['bands'][0][K]
): void {
    const instances = bacteriaStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH } };
    const bands = [...state.patch.bands];
    if (bandIndex < 0 || bandIndex >= bands.length) return;
    bands[bandIndex] = { ...bands[bandIndex]!, [key]: value };
    bacteriaStore.set({ ...instances, [deviceId]: { ...state, patch: { ...state.patch, bands } } });
}

export function setBacteriaUiLevel(deviceId: string, level: BacteriaUiLevel): void {
    const instances = bacteriaStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH } };
    bacteriaStore.set({ ...instances, [deviceId]: { ...state, uiLevel: level } });
}

export function setBacteriaActiveBand(deviceId: string, index: number): void {
    const instances = bacteriaStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH } };
    bacteriaStore.set({ ...instances, [deviceId]: { ...state, activeBand: index } });
}

export function setBacteriaActiveModule(deviceId: string, module: string): void {
    const instances = bacteriaStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH } };
    bacteriaStore.set({ ...instances, [deviceId]: { ...state, activeModule: module } });
}

export function loadBacteriaPatch(deviceId: string, patch: BacteriaPatch): void {
    const instances = bacteriaStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH } };
    bacteriaStore.set({ ...instances, [deviceId]: { ...state, patch } });
}

export function updateBacteriaMeters(
    deviceId: string,
    inputDb: number,
    outputDb: number,
    bandLevels?: number[],
    latency?: number
): void {
    const instances = bacteriaStore.value ?? {};
    const state = instances[deviceId] ?? { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH } };
    bacteriaStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            inputDb,
            outputDb,
            bandLevels: bandLevels ?? state.bandLevels,
            latency: latency ?? state.latency,
        },
    });
}
