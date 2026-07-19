import { batchStoreUpdates } from '#/infra/store/createStore';

import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';
import { removeYeastGrooveAssignments } from './removeYeastGrooveAssignments';

export function removeYeastProcessor(id: string): void {
    const state = yeastStore.value;
    if (!state || !state.processors.some((processor) => processor.id === id)) {
        return;
    }
    batchStoreUpdates(() => {
        commitYeastProjection(state.processors.filter((processor) => processor.id !== id));
        removeYeastGrooveAssignments(id);
    });
}
