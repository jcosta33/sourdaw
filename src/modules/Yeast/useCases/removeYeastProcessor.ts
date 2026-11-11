import { batchStoreUpdates } from '#/infra/store/createStore';

import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';
import { removeYeastGrooveAssignments } from './removeYeastGrooveAssignments';

export function removeYeastProcessor(id: string): boolean {
    const state = yeastStore.value;
    if (!state || !state.processors.some((processor) => processor.id === id)) {
        return false;
    }
    let grooveChanged = false;
    batchStoreUpdates(() => {
        const reconciled = commitYeastProjection(state.processors.filter((processor) => processor.id !== id));
        const removed = removeYeastGrooveAssignments(id);
        grooveChanged = reconciled || removed;
    });
    return grooveChanged;
}
