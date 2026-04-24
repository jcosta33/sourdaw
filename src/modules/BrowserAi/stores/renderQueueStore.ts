/**
 * Store for the browser AI render queue.
 *
 * Tracks which phrases are queued, rendering, or stale.
 */

import { createStore } from '#/infra/store/createStore';

import { type PhraseRenderStatus } from '../models/RenderProgress';

export type RenderQueueEntry = {
    phraseId: string;
    requestId: string;
    pipeline: 'ddsp' | 'kokoro' | 'diffsinger';
    status: PhraseRenderStatus;
    queuedAt: number;
};

export type RenderQueueState = {
    entries: RenderQueueEntry[];
    /** IDs of phrases with cached audio (cache keys) */
    cachedPhraseIds: string[];
    /** Map of phraseId → render status for the canvas stale badge */
    phraseStatusMap: Record<string, PhraseRenderStatus>;
};

export const renderQueueStore = createStore<RenderQueueState>({
    initialData: {
        entries: [],
        cachedPhraseIds: [],
        phraseStatusMap: {},
    },
});

export function enqueueRender(entry: RenderQueueEntry): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        return {
            ...state,
            entries: [...state.entries, entry],
            phraseStatusMap: { ...state.phraseStatusMap, [entry.phraseId]: 'queued' },
        };
    });
}

export function updateRenderStatus(phraseId: string, status: PhraseRenderStatus): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        const entries = state.entries.map((event) => (event.phraseId === phraseId ? { ...event, status } : event));
        return {
            ...state,
            entries,
            phraseStatusMap: { ...state.phraseStatusMap, [phraseId]: status },
        };
    });
}

export function markRenderComplete(phraseId: string, cacheKey: string): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        // Update status to 'preview' in-place — entry is preserved so renderAllStale
        // can recover the pipeline type if the phrase becomes stale later.
        const entries = state.entries.map((event) =>
            event.phraseId === phraseId ? { ...event, status: 'preview' as const } : event
        );
        const cachedPhraseIds = state.cachedPhraseIds.includes(cacheKey)
            ? state.cachedPhraseIds
            : [...state.cachedPhraseIds, cacheKey];
        return {
            ...state,
            entries,
            cachedPhraseIds,
            phraseStatusMap: { ...state.phraseStatusMap, [phraseId]: 'preview' },
        };
    });
}

export function markPhraseStale(phraseId: string): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        return {
            ...state,
            phraseStatusMap: { ...state.phraseStatusMap, [phraseId]: 'stale' },
        };
    });
}

export function cancelQueuedRender(phraseId: string): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        const entries = state.entries.filter((event) => event.phraseId !== phraseId);
        const phraseStatusMap = { ...state.phraseStatusMap };
        delete phraseStatusMap[phraseId];
        return { ...state, entries, phraseStatusMap };
    });
}
