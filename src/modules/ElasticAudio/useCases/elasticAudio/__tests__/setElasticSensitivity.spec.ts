import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, resetPreferences } from '#/modules/Preferences/useCases';

const mocks = vi.hoisted(() => ({
    execute: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.execute }));
vi.mock('../detectTransientsForClip', () => ({
    cancelTransientDetection: mocks.cancel,
    transientDetectionRevision: () => 0,
}));

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { setElasticSensitivity } from '../setElasticSensitivity';

describe('setElasticSensitivity', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.execute.mockClear();
        elasticAudioStore.set({ ...defaultElasticAudioState });
        preferencesStore.trySet(defaultPreferences);
    });

    afterEach(() => {
        preferencesStore.trySet(defaultPreferences);
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('persists the last sensitivity for a fresh preferences store', async () => {
        setElasticSensitivity(0.82);

        expect(preferencesStore.value).toHaveProperty('elasticTransientSensitivity', 0.82);

        vi.resetModules();
        const reloaded = (await import('#/modules/Preferences/stores')).preferencesStore;
        expect(reloaded.value).toHaveProperty('elasticTransientSensitivity', 0.82);
    });

    it('uses the reset preference when a pending detection fires', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        const pending = setElasticSensitivity(0.82);

        resetPreferences();
        vi.advanceTimersByTime(150);
        await pending;

        expect(mocks.execute).toHaveBeenCalledOnce();
        expect(mocks.execute).toHaveBeenCalledWith(
            {
                type: 'detectTransients',
                payload: { clipId: 'clip-1', sensitivity: 0.5 },
            },
            { signal: undefined }
        );
    });

    it('updates the canonical preference immediately', () => {
        setElasticSensitivity(0.75);
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.75);
    });

    it('clamps sensitivity into [0,1]', () => {
        setElasticSensitivity(-0.3);
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0);
        setElasticSensitivity(1.7);
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(1);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'uses the default for nonfinite sensitivity %s',
        (value) => {
            setElasticSensitivity(value);
            expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.5);
        }
    );

    it('debounces detection by 150ms when a clip is open', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        const promise = setElasticSensitivity(0.5);
        expect(mocks.execute).not.toHaveBeenCalled();
        vi.advanceTimersByTime(149);
        expect(mocks.execute).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10);
        await promise;
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        expect(mocks.execute).toHaveBeenCalledWith(
            {
                type: 'detectTransients',
                payload: { clipId: 'clip-1', sensitivity: 0.5 },
            },
            { signal: undefined }
        );
    });

    it('collapses rapid calls into a single detection on the last value', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        const first = setElasticSensitivity(0.1);
        const second = setElasticSensitivity(0.2);
        const third = setElasticSensitivity(0.9);
        vi.advanceTimersByTime(200);
        await Promise.all([first, second, third]);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        expect(mocks.execute).toHaveBeenCalledWith(
            {
                type: 'detectTransients',
                payload: { clipId: 'clip-1', sensitivity: 0.9 },
            },
            { signal: undefined }
        );
    });

    it('sets detected=true after running detection', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        const promise = setElasticSensitivity(0.5);
        vi.advanceTimersByTime(200);
        await promise;
        expect(elasticAudioStore.value?.detected).toBe(true);
    });

    it('awaits actual completion and propagates failure without detected success', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        let fail: ((error: Error) => void) | undefined;
        mocks.execute.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    fail = reject;
                })
        );
        const promise = setElasticSensitivity(0.82);
        const failure = expect(promise).rejects.toThrow('Worker failed');
        await vi.advanceTimersByTimeAsync(150);
        expect(elasticAudioStore.value?.detected).toBe(false);
        fail?.(new Error('Worker failed'));
        await failure;
        expect(elasticAudioStore.value?.detected).toBe(false);
        const retry = setElasticSensitivity(0.82);
        await vi.advanceTimersByTimeAsync(150);
        await retry;
        expect(elasticAudioStore.value?.detected).toBe(true);
    });

    it('skips detection if no clip is open', async () => {
        const promise = setElasticSensitivity(0.5);
        vi.advanceTimersByTime(200);
        await promise;
        expect(mocks.execute).not.toHaveBeenCalled();
    });
    it('settles queued cancellation as cancellation rather than completion', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        const controller = new AbortController();
        const request = setElasticSensitivity(0.82, controller.signal);
        const refused = expect(request).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await vi.advanceTimersByTimeAsync(150);
        await refused;
        expect(mocks.execute).not.toHaveBeenCalled();
        expect(elasticAudioStore.value?.detected).toBe(false);
    });
});
