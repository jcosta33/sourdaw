/**
 * Store for active inference progress.
 *
 * Tracks per-phrase render stage and progress for the phrase-level
 * progress bars shown on the canvas.
 */

import { createStore } from '#/infra/store/createStore';
import { type ActiveRender } from '../models/RenderProgress';

export type InferenceProgressState = {
    /** Map of requestId → active render state */
    activeRenders: Record<string, Omit<ActiveRender, 'abortController'>>;
};

export const inferenceProgressStore = createStore<InferenceProgressState>({
    initialData: { activeRenders: {} },
});

export function startActiveRender(render: Omit<ActiveRender, 'abortController'>): void {
    inferenceProgressStore.update((state) => {
        if (!state) {
            return state;
        }
        return {
            activeRenders: { ...state.activeRenders, [render.requestId]: render },
        };
    });
}

export function updateActiveRenderProgress({
    requestId,
    stage,
    progress,
}: {
    requestId: string;
    stage: string;
    progress: number;
}): void {
    inferenceProgressStore.update((state) => {
        if (!state) {
            return state;
        }
        const current = state.activeRenders[requestId];
        if (!current) {
            return state;
        }
        return {
            activeRenders: {
                ...state.activeRenders,
                [requestId]: { ...current, stage, progress },
            },
        };
    });
}

export function clearActiveRender(requestId: string): void {
    inferenceProgressStore.update((state) => {
        if (!state) {
            return state;
        }
        const { [requestId]: _removed, ...rest } = state.activeRenders;
        return { activeRenders: rest };
    });
}
