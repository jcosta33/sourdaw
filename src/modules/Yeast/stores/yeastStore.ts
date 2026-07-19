/**
 * Yeast store — the serializable projection used by the UI and use cases.
 *
 * Worker handles, racks, and processor instances live in the engine
 * runtime. This store never holds those handles or executes MIDI processing.
 */

import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { PROCESSOR_TYPES, type ProcessorType } from '../models/ProcessorCatalog';

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProcessor(value: unknown): YeastProcessorInfo | null {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.type !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.bypassed !== 'boolean'
    ) {
        return null;
    }
    const id = value.id.normalize('NFKC').trim();
    const type = PROCESSOR_TYPES.find((candidate) => candidate.type === value.type)?.type;
    if (!id || !type) {
        return null;
    }
    const params = isRecord(value.params)
        ? Object.fromEntries(
              Object.entries(value.params).filter(
                  (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])
              )
          )
        : undefined;
    return {
        id,
        type,
        name: value.name,
        bypassed: value.bypassed,
        ...(params && Object.keys(params).length > 0 ? { params } : {}),
    };
}

function normalizeYeastStateFromCrdt(value: unknown): YeastState {
    if (!isRecord(value) || !Array.isArray(value.processors)) {
        return structuredClone(defaultState);
    }
    const processorsById = new Map<string, YeastProcessorInfo>();
    for (const rawProcessor of value.processors) {
        const processor = normalizeProcessor(rawProcessor);
        if (processor) {
            processorsById.set(processor.id, processor);
        }
    }
    const uiLevel = ([1, 2, 3, 4, 5] as const).find((level) => level === value.uiLevel) ?? 1;
    return { processors: [...processorsById.values()], uiLevel };
}

export const yeastStore = createStore<YeastState>({
    storage: createAutomergeStorage('root', 'yeast', {
        toCrdt: ({ processors, uiLevel }) => ({ processors, uiLevel }),
        fromCrdt: normalizeYeastStateFromCrdt,
    }),
    initialData: defaultState,
});
