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

export function isCurrentRenderRequest(phraseId: string, requestId: string): boolean {
    return (
        renderQueueStore.value?.entries.some((entry) => entry.phraseId === phraseId && entry.requestId === requestId) ??
        false
    );
}

export function enqueueRender(entry: RenderQueueEntry): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        return {
            ...state,
            entries: [...state.entries.filter((event) => event.phraseId !== entry.phraseId), entry],
            phraseStatusMap: { ...state.phraseStatusMap, [entry.phraseId]: 'queued' },
        };
    });
}

export function updateRenderStatus(phraseId: string, requestId: string, status: PhraseRenderStatus): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        const ownsPhrase = state.entries.some((event) => event.phraseId === phraseId && event.requestId === requestId);
        if (!ownsPhrase) {
            return state;
        }
        const entries = state.entries.map((event) =>
            event.phraseId === phraseId && event.requestId === requestId ? { ...event, status } : event
        );
        return {
            ...state,
            entries,
            phraseStatusMap: { ...state.phraseStatusMap, [phraseId]: status },
        };
    });
}

export function markRenderComplete(phraseId: string, requestId: string, cacheKey: string): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        const ownsPhrase = state.entries.some((event) => event.phraseId === phraseId && event.requestId === requestId);
        if (!ownsPhrase) {
            return state;
        }
        // Drop the completed entry from the queue — its terminal state lives in
        // phraseStatusMap (which the StatusBar count and the stale-subscription read).
        // Keeping completed entries grew `entries` unbounded for the session, since
        // nothing in the module removes them on success.
        const entries = state.entries.filter((event) => event.phraseId !== phraseId || event.requestId !== requestId);
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

export function cancelQueuedRender(phraseId: string, requestId: string, hasActiveRender = false): void {
    renderQueueStore.update((state) => {
        if (!state) {
            return state;
        }
        const phraseEntries = state.entries.filter((event) => event.phraseId === phraseId);
        const ownsPhrase = phraseEntries.some((event) => event.requestId === requestId);
        if (!ownsPhrase && (phraseEntries.length > 0 || !hasActiveRender)) {
            return state;
        }
        const entries = ownsPhrase
            ? state.entries.filter((event) => event.phraseId !== phraseId || event.requestId !== requestId)
            : state.entries;
        return {
            ...state,
            entries,
            phraseStatusMap: { ...state.phraseStatusMap, [phraseId]: 'not-rendered' },
        };
    });
}
