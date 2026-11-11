import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';

export function setYeastProcessorBypass(id: string, bypassed: boolean): boolean {
    const state = yeastStore.value;
    if (!state) {
        return false;
    }

    const processor = state.processors.find((entry) => entry.id === id);
    if (!processor) {
        return false;
    }
    return commitYeastProjection(state.processors.map((entry) => (entry.id === id ? { ...entry, bypassed } : entry)));
}
