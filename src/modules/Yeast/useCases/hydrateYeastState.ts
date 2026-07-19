import { yeastStore, type YeastState } from '../stores/yeastStore';

type HydrateYeastStateInput = Pick<YeastState, 'processors' | 'uiLevel'> | undefined;

export function hydrateYeastState(state: HydrateYeastStateInput): void {
    if (!state) {
        yeastStore.set({ processors: [], uiLevel: 1 });
        return;
    }
    yeastStore.set({ processors: structuredClone(state.processors), uiLevel: state.uiLevel });
}
