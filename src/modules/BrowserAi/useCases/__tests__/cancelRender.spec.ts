import { describe, it, expect, vi, beforeEach } from 'vitest';

const cancelOnnxRequest = vi.hoisted(() => vi.fn());
const cancelTfjsRequest = vi.hoisted(() => vi.fn());
const terminateOnnxWorker = vi.hoisted(() => vi.fn());
const terminateTfjsWorker = vi.hoisted(() => vi.fn());

vi.mock('../../repositories/inferenceWorkerBridge', () => ({
    inferenceWorkerBridge: {
        cancelOnnxRequest,
        cancelTfjsRequest,
        terminateOnnxWorker,
        terminateTfjsWorker,
    },
}));

import { type ActiveRender } from '../../models/RenderProgress';
import { inferenceProgressStore, startActiveRender } from '../../stores/inferenceProgressStore';
import { enqueueRender, renderQueueStore } from '../../stores/renderQueueStore';
import { cancelRender } from '../cancelRender';

function seedActiveRender(over: Partial<ActiveRender> = {}): ActiveRender {
    const render: ActiveRender = {
        requestId: 'req-A',
        phraseId: 'phrase-A',
        pipeline: 'kokoro',
        status: 'rendering-browser',
        stage: 'Synthesizing speech',
        progress: 0.3,
        startedAt: Date.now(),
        ...over,
    };
    startActiveRender(render);
    return render;
}

describe('cancelRender', () => {
    beforeEach(() => {
        cancelOnnxRequest.mockClear();
        cancelTfjsRequest.mockClear();
        terminateOnnxWorker.mockClear();
        terminateTfjsWorker.mockClear();
        // Reset stores to a clean slate between cases.
        inferenceProgressStore.set({ activeRenders: {} });
        renderQueueStore.set({ entries: [], cachedPhraseIds: [], phraseStatusMap: {} });
    });

    it('cancels only the targeted ONNX request, never the whole worker (kokoro)', () => {
        seedActiveRender({ requestId: 'req-A', phraseId: 'phrase-A', pipeline: 'kokoro' });

        cancelRender({ phraseId: 'phrase-A', requestId: 'req-A' });

        expect(cancelOnnxRequest).toHaveBeenCalledTimes(1);
        expect(cancelOnnxRequest).toHaveBeenCalledWith('req-A');
        // The blanket terminate path — which would kill sibling renders — must not fire.
        expect(terminateOnnxWorker).not.toHaveBeenCalled();
        expect(cancelTfjsRequest).not.toHaveBeenCalled();
        expect(terminateTfjsWorker).not.toHaveBeenCalled();
    });

    it('routes diffsinger renders to the ONNX per-request cancel', () => {
        seedActiveRender({ requestId: 'req-D', phraseId: 'phrase-D', pipeline: 'diffsinger' });

        cancelRender({ phraseId: 'phrase-D', requestId: 'req-D' });

        expect(cancelOnnxRequest).toHaveBeenCalledWith('req-D');
        expect(terminateOnnxWorker).not.toHaveBeenCalled();
    });

    it('routes ddsp renders to the TF.js per-request cancel, never the ONNX worker', () => {
        seedActiveRender({ requestId: 'req-T', phraseId: 'phrase-T', pipeline: 'ddsp' });

        cancelRender({ phraseId: 'phrase-T', requestId: 'req-T' });

        expect(cancelTfjsRequest).toHaveBeenCalledWith('req-T');
        expect(cancelOnnxRequest).not.toHaveBeenCalled();
        expect(terminateOnnxWorker).not.toHaveBeenCalled();
    });

    it('resolves the pipeline from the active render even when the queue entry is missing (no collateral ONNX terminate)', () => {
        // Active render says DDSP, but there is NO matching queue entry (stale/missing lookup).
        // The old code fell to the ONNX terminate branch here, killing unrelated ONNX renders.
        seedActiveRender({ requestId: 'req-T', phraseId: 'phrase-T', pipeline: 'ddsp' });
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: { 'phrase-T': 'rendering-browser' },
        });

        cancelRender({ phraseId: 'phrase-T', requestId: 'req-T' });

        expect(cancelTfjsRequest).toHaveBeenCalledWith('req-T');
        expect(cancelOnnxRequest).not.toHaveBeenCalled();
        expect(terminateOnnxWorker).not.toHaveBeenCalled();
        expect(renderQueueStore.value?.phraseStatusMap['phrase-T']).toBe('not-rendered');
    });

    it('does NOT terminate the ONNX worker when the pipeline is unknown (no active render, no queue entry)', () => {
        // Neither store knows this phrase: the old code defaulted to terminateOnnxWorker(),
        // wiping every in-flight DiffSinger/Kokoro render. Now it must touch no worker.
        cancelRender({ phraseId: 'phrase-unknown', requestId: 'req-unknown' });

        expect(cancelOnnxRequest).not.toHaveBeenCalled();
        expect(cancelTfjsRequest).not.toHaveBeenCalled();
        expect(terminateOnnxWorker).not.toHaveBeenCalled();
        expect(terminateTfjsWorker).not.toHaveBeenCalled();
    });

    it('falls back to the queue-entry pipeline when there is no active render', () => {
        // No active render in the progress store, but the queue still has the entry.
        enqueueRender({
            phraseId: 'phrase-Q',
            requestId: 'req-Q',
            pipeline: 'ddsp',
            status: 'queued',
            queuedAt: Date.now(),
        });

        cancelRender({ phraseId: 'phrase-Q', requestId: 'req-Q' });

        expect(cancelTfjsRequest).toHaveBeenCalledWith('req-Q');
        expect(cancelOnnxRequest).not.toHaveBeenCalled();
        expect(terminateOnnxWorker).not.toHaveBeenCalled();
    });

    it('cancelling render A leaves render B untouched on the shared ONNX worker', () => {
        // Two concurrent ONNX renders. Cancelling A must only target A's requestId.
        seedActiveRender({ requestId: 'req-A', phraseId: 'phrase-A', pipeline: 'kokoro' });
        startActiveRender({
            requestId: 'req-B',
            phraseId: 'phrase-B',
            pipeline: 'diffsinger',
            status: 'rendering-browser',
            stage: 'Encoding phonemes',
            progress: 0.1,
            startedAt: Date.now(),
        });

        cancelRender({ phraseId: 'phrase-A', requestId: 'req-A' });

        expect(cancelOnnxRequest).toHaveBeenCalledTimes(1);
        expect(cancelOnnxRequest).toHaveBeenCalledWith('req-A');
        expect(cancelOnnxRequest).not.toHaveBeenCalledWith('req-B');
        expect(terminateOnnxWorker).not.toHaveBeenCalled();
        // Render B's active-render state remains in the store.
        expect(inferenceProgressStore.value?.activeRenders['req-B']).toBeDefined();
    });

    it('does not remove the newer queued request when an older request for the same phrase is cancelled', () => {
        seedActiveRender({ requestId: 'req-old', phraseId: 'phrase-A', pipeline: 'ddsp' });
        enqueueRender({
            phraseId: 'phrase-A',
            requestId: 'req-old',
            pipeline: 'ddsp',
            status: 'rendering-browser',
            queuedAt: 1,
        });
        enqueueRender({
            phraseId: 'phrase-A',
            requestId: 'req-new',
            pipeline: 'ddsp',
            status: 'queued',
            queuedAt: 2,
        });

        cancelRender({ phraseId: 'phrase-A', requestId: 'req-old' });

        expect(renderQueueStore.value?.entries).toEqual([
            expect.objectContaining({ phraseId: 'phrase-A', requestId: 'req-new' }),
        ]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('queued');
    });

    it('marks the current queued request not rendered when it is cancelled', () => {
        enqueueRender({
            phraseId: 'phrase-A',
            requestId: 'req-current',
            pipeline: 'ddsp',
            status: 'queued',
            queuedAt: 1,
        });

        cancelRender({ phraseId: 'phrase-A', requestId: 'req-current' });

        expect(renderQueueStore.value?.entries).toEqual([]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('not-rendered');
    });

    it('clears the cancelled render from the active-render store', () => {
        seedActiveRender({ requestId: 'req-A', phraseId: 'phrase-A', pipeline: 'kokoro' });

        cancelRender({ phraseId: 'phrase-A', requestId: 'req-A' });

        expect(inferenceProgressStore.value?.activeRenders['req-A']).toBeUndefined();
    });
});
