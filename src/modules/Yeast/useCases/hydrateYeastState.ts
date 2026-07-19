import { yeastStore, type YeastState } from '../stores/yeastStore';

import { reconcileYeastGrooveAssignments } from './reconcileYeastGrooveAssignments';

type HydrateYeastStateInput = Pick<YeastState, 'processors'> | undefined;

export function hydrateYeastState(state: HydrateYeastStateInput): void {
    const uiLevel = yeastStore.value?.uiLevel ?? 1;
    if (!state) {
        yeastStore.set({ processors: [], uiLevel });
        reconcileYeastGrooveAssignments();
        return;
    }
    yeastStore.set({ processors: structuredClone(state.processors), uiLevel });
    reconcileYeastGrooveAssignments();
}
