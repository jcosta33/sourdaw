import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';

export function removeYeastProcessor(id: string): void {
    const state = yeastStore.value;
    if (!state || !state.processors.some((processor) => processor.id === id)) {
        return;
    }
    commitYeastProjection(state.processors.filter((processor) => processor.id !== id));
}
