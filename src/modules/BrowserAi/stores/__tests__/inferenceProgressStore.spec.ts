import { beforeEach, describe, expect, it } from 'vitest';

import { type ActiveRender } from '../../models/RenderProgress';
import {
    clearActiveRender,
    inferenceProgressStore,
    startActiveRender,
    updateActiveRenderProgress,
} from '../inferenceProgressStore';

function makeRender(requestId: string): ActiveRender {
    return {
        requestId,
        phraseId: 'phrase-1',
        pipeline: 'kokoro',
        status: 'rendering-browser',
        stage: 'inference',
        progress: 0,
        startedAt: 0,
    };
}

describe('inferenceProgressStore', () => {
    beforeEach(() => {
        inferenceProgressStore.set({ activeRenders: {} });
    });

    it('adds a new active render keyed by requestId', () => {
        startActiveRender(makeRender('req-1'));

        expect(inferenceProgressStore.value?.activeRenders['req-1']).toMatchObject({ requestId: 'req-1' });
    });

    it('updates the stage and progress of an existing active render', () => {
        startActiveRender(makeRender('req-1'));

        updateActiveRenderProgress({ requestId: 'req-1', stage: 'decoding', progress: 0.5 });

        expect(inferenceProgressStore.value?.activeRenders['req-1']).toMatchObject({
            stage: 'decoding',
            progress: 0.5,
        });
    });

    it('leaves the state untouched when updating a render id that is not active', () => {
        startActiveRender(makeRender('req-1'));
        const before = inferenceProgressStore.value;

        updateActiveRenderProgress({ requestId: 'does-not-exist', stage: 'decoding', progress: 0.5 });

        expect(inferenceProgressStore.value).toBe(before);
    });

    it('removes the active render on clear', () => {
        startActiveRender(makeRender('req-1'));
        startActiveRender(makeRender('req-2'));

        clearActiveRender('req-1');

        expect(inferenceProgressStore.value?.activeRenders['req-1']).toBeUndefined();
        expect(inferenceProgressStore.value?.activeRenders['req-2']).toMatchObject({ requestId: 'req-2' });
    });

    it('is a no-op when the store has not been initialized', () => {
        inferenceProgressStore.clear();

        startActiveRender(makeRender('req-1'));
        updateActiveRenderProgress({ requestId: 'req-1', stage: 'decoding', progress: 0.5 });
        clearActiveRender('req-1');

        expect(inferenceProgressStore.value).toBeNull();
    });
});
