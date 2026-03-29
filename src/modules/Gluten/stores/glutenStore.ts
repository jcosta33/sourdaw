/**
 * Reactive state for the Gluten compressor.
 */
import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type GlutenPatch, DEFAULT_PATCH } from '../models/GlutenPatch';

const logger = Container.getInstance().get(Logger);

export type GlutenState = {
    patch: GlutenPatch;
    grDb: number;
    inputDb: number;
    outputDb: number;
    uiLevel: 1 | 2 | 3 | 4 | 5;
};

export const glutenStore = new Store<GlutenState>(logger, {
    initialData: {
        patch: DEFAULT_PATCH,
        grDb: 0,
        inputDb: -100,
        outputDb: -100,
        uiLevel: 2,
    },
});

export function setGlutenParam<K extends keyof GlutenPatch>(key: K, value: GlutenPatch[K]): void {
    const state = glutenStore.value;
    if (!state) { return; }
    glutenStore.set({
        ...state,
        patch: { ...state.patch, [key]: value },
    });
}

export function setGlutenUiLevel(level: 1 | 2 | 3 | 4 | 5): void {
    const state = glutenStore.value;
    if (state) {
        glutenStore.set({ ...state, uiLevel: level });
    }
}

export function loadGlutenPatch(patch: GlutenPatch): void {
    const state = glutenStore.value;
    if (state) {
        glutenStore.set({ ...state, patch });
    }
}

export function updateGlutenMeters(grDb: number, inputDb: number, outputDb: number): void {
    const state = glutenStore.value;
    if (state) {
        glutenStore.set({ ...state, grDb, inputDb, outputDb });
    }
}
