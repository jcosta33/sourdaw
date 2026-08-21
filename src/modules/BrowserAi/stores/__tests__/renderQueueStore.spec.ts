import { describe, it, expect, beforeEach } from 'vitest';

import {
    renderQueueStore,
    enqueueRender,
    markRenderComplete,
    updateRenderStatus,
    markPhraseStale,
    cancelQueuedRender,
    type RenderQueueEntry,
} from '../renderQueueStore';

function makeEntry(over: Partial<RenderQueueEntry> = {}): RenderQueueEntry {
    return {
        phraseId: 'phrase-A',
        requestId: 'req-A',
        pipeline: 'kokoro',
        status: 'preparing',
        queuedAt: Date.now(),
        ...over,
    };
}

describe('markRenderComplete', () => {
    beforeEach(() => {
        renderQueueStore.set({ entries: [], cachedPhraseIds: [], phraseStatusMap: {} });
    });

    it('removes the completed entry from the queue so it does not grow unbounded', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-A' }));
        enqueueRender(makeEntry({ phraseId: 'phrase-B', requestId: 'req-B' }));

        markRenderComplete('phrase-A', 'req-A', 'cache-key-A');

        const ids = renderQueueStore.value?.entries.map((e) => e.phraseId) ?? [];
        // The completed phrase is gone; the still-in-flight one remains.
        expect(ids).toEqual(['phrase-B']);
    });

    it('records the completed phrase as preview in the status map after the entry is dropped', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-A' }));

        markRenderComplete('phrase-A', 'req-A', 'cache-key-A');

        // Terminal state survives in phraseStatusMap even though the entry is removed —
        // this is what the StatusBar count and the stale-on-edit subscription read.
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('preview');
        expect(renderQueueStore.value?.entries).toHaveLength(0);
    });

    it('leaves the queue empty after a render completes, not holding a stale preview entry', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-A' }));

        markRenderComplete('phrase-A', 'req-A', 'cache-key-A');

        // No entry should retain status 'preview' in the queue — that retention was the
        // unbounded-growth bug.
        const previewEntries = (renderQueueStore.value?.entries ?? []).filter((e) => e.status === 'preview');
        expect(previewEntries).toEqual([]);
    });

    it('should leave a newer same-phrase request untouched when an older request completes', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-old' }));
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-new' }));

        markRenderComplete('phrase-A', 'req-old', 'cache-key-old');

        expect(renderQueueStore.value).toEqual({
            entries: [expect.objectContaining({ phraseId: 'phrase-A', requestId: 'req-new', status: 'preparing' })],
            cachedPhraseIds: [],
            phraseStatusMap: { 'phrase-A': 'queued' },
        });
    });

    it('should let the current same-phrase request complete after an older completion was ignored', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-old' }));
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-new' }));
        markRenderComplete('phrase-A', 'req-old', 'cache-key-old');

        markRenderComplete('phrase-A', 'req-new', 'cache-key-new');

        expect(renderQueueStore.value).toEqual({
            entries: [],
            cachedPhraseIds: ['cache-key-new'],
            phraseStatusMap: { 'phrase-A': 'preview' },
        });
    });
});

describe('updateRenderStatus / markPhraseStale / cancelQueuedRender', () => {
    beforeEach(() => {
        renderQueueStore.set({ entries: [], cachedPhraseIds: [], phraseStatusMap: {} });
    });

    it('updates the status of the matching queue entry and the status map', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-A' }));

        updateRenderStatus('phrase-A', 'req-A', 'rendering-browser');

        expect(renderQueueStore.value?.entries[0]?.status).toBe('rendering-browser');
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('rendering-browser');
    });

    it('marks a phrase stale in the status map', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-A' }));

        markPhraseStale('phrase-A');

        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('stale');
    });

    it('should remove the current queued entry and mark its phrase not rendered on cancel', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-A' }));

        cancelQueuedRender('phrase-A', 'req-A');

        expect(renderQueueStore.value?.entries).toEqual([]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('not-rendered');
    });

    it('should not let an older failure overwrite the newer same-phrase request', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-old' }));
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-new' }));

        updateRenderStatus('phrase-A', 'req-old', 'error');

        expect(renderQueueStore.value?.entries).toEqual([
            expect.objectContaining({ phraseId: 'phrase-A', requestId: 'req-new', status: 'preparing' }),
        ]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('queued');
    });

    it('should let the current same-phrase failure update its own status', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-new' }));

        updateRenderStatus('phrase-A', 'req-new', 'error');

        expect(renderQueueStore.value?.entries[0]?.status).toBe('error');
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('error');
    });

    it('should not let an older cancellation remove the newer same-phrase request', () => {
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-old' }));
        enqueueRender(makeEntry({ phraseId: 'phrase-A', requestId: 'req-new' }));

        cancelQueuedRender('phrase-A', 'req-old');

        expect(renderQueueStore.value?.entries).toEqual([
            expect.objectContaining({ phraseId: 'phrase-A', requestId: 'req-new' }),
        ]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('queued');
    });

    it('is a no-op for every mutator when the store has not been initialized', () => {
        renderQueueStore.clear();

        enqueueRender(makeEntry());
        updateRenderStatus('phrase-A', 'req-A', 'rendering-browser');
        markRenderComplete('phrase-A', 'req-A', 'cache-key-A');
        markPhraseStale('phrase-A');
        cancelQueuedRender('phrase-A', 'req-A');

        expect(renderQueueStore.value).toBeNull();
    });
});
