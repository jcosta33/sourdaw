/**
 * Reactive state for the Bacteria creative multi-effects processor.
 */
import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type BacteriaPatch, DEFAULT_PATCH } from '../models/BacteriaPatch';

const logger = Container.getInstance().get(Logger);

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

export const bacteriaStore = new Store<BacteriaState>(logger, {
    initialData: {
        patch: DEFAULT_PATCH,
        inputDb: -100,
        outputDb: -100,
        bandLevels: [0, 0, 0, 0, 0, 0],
        latency: 0,
        activeBand: 0,
        uiLevel: 1,
        activeModule: 'distortion',
    },
});

export function setBacteriaParam<K extends keyof BacteriaPatch>(key: K, value: BacteriaPatch[K]): void {
    const state = bacteriaStore.value;
    if (!state) {
        return;
    }
    bacteriaStore.set({
        ...state,
        patch: { ...state.patch, [key]: value },
    });
}

export function setBacteriaBandParam<K extends keyof BacteriaPatch['bands'][0]>(
    bandIndex: number,
    key: K,
    value: BacteriaPatch['bands'][0][K]
): void {
    const state = bacteriaStore.value;
    if (!state) {
        return;
    }
    const bands = [...state.patch.bands];
    if (bandIndex < 0 || bandIndex >= bands.length) {
        return;
    }
    bands[bandIndex] = { ...bands[bandIndex]!, [key]: value };
    bacteriaStore.set({
        ...state,
        patch: { ...state.patch, bands },
    });
}

export function setBacteriaUiLevel(level: BacteriaUiLevel): void {
    const state = bacteriaStore.value;
    if (state) {
        bacteriaStore.set({ ...state, uiLevel: level });
    }
}

export function setBacteriaActiveBand(index: number): void {
    const state = bacteriaStore.value;
    if (state) {
        bacteriaStore.set({ ...state, activeBand: index });
    }
}

export function setBacteriaActiveModule(module: string): void {
    const state = bacteriaStore.value;
    if (state) {
        bacteriaStore.set({ ...state, activeModule: module });
    }
}

export function loadBacteriaPatch(patch: BacteriaPatch): void {
    const state = bacteriaStore.value;
    if (state) {
        bacteriaStore.set({ ...state, patch });
    }
}

export function updateBacteriaMeters(inputDb: number, outputDb: number, bandLevels?: number[], latency?: number): void {
    const state = bacteriaStore.value;
    if (state) {
        bacteriaStore.set({
            ...state,
            inputDb,
            outputDb,
            bandLevels: bandLevels ?? state.bandLevels,
            latency: latency ?? state.latency,
        });
    }
}
