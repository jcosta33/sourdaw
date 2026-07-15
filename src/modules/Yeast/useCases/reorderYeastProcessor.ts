import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';

export function reorderYeastProcessor(fromIdx: number, toIdx: number): void {
    const state = yeastStore.value;
    if (!state || fromIdx < 0 || fromIdx >= state.processors.length || toIdx < 0 || toIdx >= state.processors.length) {
        return;
    }

    const processors = [...state.processors];
    const [moved] = processors.splice(fromIdx, 1);
    processors.splice(toIdx, 0, moved!);
    commitYeastProjection(processors);
}
