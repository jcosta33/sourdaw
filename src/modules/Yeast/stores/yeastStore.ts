/**
 * Yeast store — the serializable projection used by the UI and use cases.
 *
 * Worker handles, racks, and processor instances live in the engine
 * runtime. This store never holds those handles or executes MIDI processing.
 */

import { createStore } from '#/infra/store/createStore';

import type { ProcessorType } from '../models/ProcessorCatalog';
import type { YeastRuntimeStatus } from '../models/YeastProcessorProjection';

export type YeastProcessorType = ProcessorType;

export type YeastProcessorInfo = {
    id: string;
    type: YeastProcessorType;
    name: string;
    bypassed: boolean;
    params?: Record<string, number>;
};

export type YeastState = {
    processors: YeastProcessorInfo[];
    uiLevel: 1 | 2 | 3 | 4 | 5;
    runtimeStatus?: YeastRuntimeStatus;
    runtimeError?: string;
};

const defaultState: YeastState = {
    processors: [],
    uiLevel: 1,
};

export const yeastStore = createStore<YeastState>({ initialData: defaultState });
