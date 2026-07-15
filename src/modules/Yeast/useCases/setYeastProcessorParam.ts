import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';

export function setYeastProcessorParam(id: string, name: string, value: number): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const processor = state.processors.find((entry) => entry.id === id);
    if (!processor) {
        return;
    }
    commitYeastProjection(
        state.processors.map((entry) =>
            entry.id === id ? { ...entry, params: { ...entry.params, [name]: value } } : entry
        )
    );
}
