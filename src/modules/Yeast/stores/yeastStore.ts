/**
 * Yeast store — the serializable projection used by the UI and use cases.
 *
 * Worker handles, racks, and processor instances live in the engine
 * runtime. This store never holds those handles or executes MIDI processing.
 */

import { createStore } from '#/infra/store/createStore';
import { type Store } from '#/infra/store/types';

import { type YeastState } from '../models/YeastState';

import { createYeastAutomergeStorage } from './yeastAutomergeStorage';

export type { YeastProcessorInfo, YeastProcessorType, YeastState } from '../models/YeastState';

const defaultState: YeastState = {
    processors: [],
    uiLevel: 1,
};

function readInitialYeastState(): YeastState | null {
    return null;
}

const localStateReader: { read: () => YeastState | null } = { read: readInitialYeastState };
const yeastStorage = createYeastAutomergeStorage((): YeastState | null => localStateReader.read());

export const yeastStore: Store<YeastState> = createStore<YeastState>({
    storage: yeastStorage,
    initialData: defaultState,
});

function readCurrentYeastState(): YeastState | null {
    return yeastStore.value;
}

localStateReader.read = readCurrentYeastState;
