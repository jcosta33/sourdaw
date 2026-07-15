import { setYeastRuntimeProjection } from '../engine/yeastRuntime';
import { createDurableYeastProcessorParams, createYeastProcessorProjection } from '../models/YeastProcessorProjection';
import { yeastStore, type YeastProcessorInfo } from '../stores/yeastStore';

export function commitYeastProjection(processors: readonly YeastProcessorInfo[]): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const nextProcessors = processors.map((processor) => ({
        ...processor,
        params: createDurableYeastProcessorParams(processor.type, processor.params),
    }));
    yeastStore.set({
        ...state,
        processors: nextProcessors,
    });
    setYeastRuntimeProjection(createYeastProcessorProjection(nextProcessors));
}
