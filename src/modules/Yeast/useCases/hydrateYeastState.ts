import { yeastStore, type YeastState } from '../stores/yeastStore';

type HydrateYeastStateInput = Pick<YeastState, 'processors' | 'uiLevel'> | undefined;

export function hydrateYeastState(state: HydrateYeastStateInput): void {
    yeastStore.set(
        state
            ? { processors: structuredClone(state.processors), uiLevel: state.uiLevel }
            : { processors: [], uiLevel: 1 }
    );
}
