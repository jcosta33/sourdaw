import { type ProcessorType } from './ProcessorCatalog';
import { type YeastRuntimeStatus } from './YeastProcessorProjection';

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
