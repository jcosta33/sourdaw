import type { ProcessorType } from './ProcessorCatalog';

export type YeastProcessorProjectionItem = {
    id: string;
    type: ProcessorType;
    bypassed: boolean;
    params: Record<string, number>;
};

export type YeastProcessorProjection = YeastProcessorProjectionItem[];

export type YeastRuntimeStatus = 'uninitialized' | 'initializing' | 'ready' | 'unavailable';

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
        params: { ...processor.params },
    }));
}
