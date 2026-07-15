import type { ProcessorType } from './ProcessorCatalog';

export type YeastProcessorProjectionItem = {
    id: string;
    type: ProcessorType;
    bypassed: boolean;
    params: Record<string, number>;
};

export type YeastProcessorProjection = YeastProcessorProjectionItem[];

export type YeastRuntimeStatus = 'uninitialized' | 'initializing' | 'ready' | 'unavailable';

export function createDurableYeastProcessorParams(
    type: ProcessorType,
    params: Record<string, number> | undefined
): Record<string, number> {
    const durableParams = { ...(params ?? {}) };
    if (type === 'chordMemory') {
        delete durableParams.learn;
        delete durableParams.clear;
    }
    return durableParams;
}

type YeastProcessorProjectionSource = {
    id: string;
    type: ProcessorType;
    bypassed: boolean;
    params?: Record<string, number>;
};

export function createYeastProcessorProjection(
    processors: readonly YeastProcessorProjectionSource[]
): YeastProcessorProjection {
    return processors.map((processor) => ({
        id: processor.id,
        type: processor.type,
        bypassed: processor.bypassed,
        params: createDurableYeastProcessorParams(processor.type, processor.params),
    }));
}
