import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    detectTransientsForClip: vi.fn().mockReturnValue({ ok: true, added: 0, kept: 0, removed: 0 }),
}));

vi.mock('../detectTransientsForClip', () => ({
    detectTransientsForClip: (...args: unknown[]) => mocks.detectTransientsForClip(...args),
}));

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { setElasticSensitivity } from '../setElasticSensitivity';

describe('setElasticSensitivity', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.detectTransientsForClip.mockClear();
        elasticAudioStore.set({ ...defaultElasticAudioState });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('updates the sensitivity in the store immediately', () => {
        setElasticSensitivity(0.75);
        expect(elasticAudioStore.value?.sensitivity).toBe(0.75);
    });

    it('clamps sensitivity into [0,1]', () => {
        setElasticSensitivity(-0.3);
        expect(elasticAudioStore.value?.sensitivity).toBe(0);
        setElasticSensitivity(1.7);
        expect(elasticAudioStore.value?.sensitivity).toBe(1);
    });

    it('debounces detection by 150ms when a clip is open', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        const promise = setElasticSensitivity(0.5);
        expect(mocks.detectTransientsForClip).not.toHaveBeenCalled();
        vi.advanceTimersByTime(149);
        expect(mocks.detectTransientsForClip).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10);
        await promise;
        expect(mocks.detectTransientsForClip).toHaveBeenCalledTimes(1);
        expect(mocks.detectTransientsForClip).toHaveBeenCalledWith('clip-1', 0.5);
    });

    it('collapses rapid calls into a single detection on the last value', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        const first = setElasticSensitivity(0.1);
        const second = setElasticSensitivity(0.2);
        const third = setElasticSensitivity(0.9);
        vi.advanceTimersByTime(200);
        await Promise.all([first, second, third]);
        expect(mocks.detectTransientsForClip).toHaveBeenCalledTimes(1);
        expect(mocks.detectTransientsForClip).toHaveBeenCalledWith('clip-1', 0.9);
    });

    it('sets detected=true after running detection', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        const promise = setElasticSensitivity(0.5);
        vi.advanceTimersByTime(200);
        await promise;
        expect(elasticAudioStore.value?.detected).toBe(true);
    });

    it('skips detection if no clip is open', async () => {
        const promise = setElasticSensitivity(0.5);
        vi.advanceTimersByTime(200);
        await promise;
        expect(mocks.detectTransientsForClip).not.toHaveBeenCalled();
    });
});
