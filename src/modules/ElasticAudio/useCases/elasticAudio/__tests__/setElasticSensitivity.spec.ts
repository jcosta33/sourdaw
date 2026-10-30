import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { clipSelectionStore, defaultClipSelectionState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import * as crdt from '#/modules/CrdtDocument/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, resetPreferences } from '#/modules/Preferences/useCases';

const mocks = vi.hoisted(() => ({
    detectTransientsForClip: vi.fn().mockReturnValue({ ok: true, added: 0, kept: 0, removed: 0 }),
    notify: vi.fn(),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notify }));

vi.mock('../detectTransientsForClip', () => ({
    detectTransientsForClip: (...args: unknown[]) => mocks.detectTransientsForClip(...args),
}));

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { setElasticSensitivity } from '../setElasticSensitivity';

let rootIdentity = 'root-1';
let buffer: AudioBuffer;

function select(clipId: string | null): void {
    clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: clipId });
}

function makeBuffer(): AudioBuffer {
    const samples = new Float32Array(100);
    return {
        length: samples.length,
        sampleRate: 48_000,
        numberOfChannels: 1,
        duration: samples.length / 48_000,
        getChannelData: () => samples,
        copyFromChannel: (destination) => destination.set(samples),
        copyToChannel: (source) => samples.set(source),
    };
}

describe('setElasticSensitivity', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.detectTransientsForClip.mockReset().mockReturnValue({ ok: true, added: 0, kept: 0, removed: 0 });
        mocks.notify.mockClear();
        rootIdentity = 'root-1';
        buffer = makeBuffer();
        vi.spyOn(crdt, 'captureProjectRootIdentity').mockImplementation(() => rootIdentity);
        vi.spyOn(audioBufferCache, 'get').mockImplementation((id) => (id.startsWith('buffer-') ? buffer : undefined));
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const track = createTrack({ id: 'track', name: 'Audio', kind: 'audio', withoutDefaultDevice: true });
        trackStore.set({
            tracks: [
                {
                    ...track,
                    clips: ['clip-1', 'clip-2'].map((id): ReturnType<typeof createTrack>['clips'][number] => ({
                        id,
                        trackId: track.id,
                        name: id,
                        type: 'audio',
                        audioBufferId: `buffer-${id}`,
                        startBeat: 0,
                        endBeat: 1,
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#123456',
                        locked: false,
                        muted: false,
                    })),
                },
            ],
            selectedTrackId: track.id,
        });
        select(null);
        elasticAudioStore.set({ ...defaultElasticAudioState });
        preferencesStore.trySet(defaultPreferences);
    });

    afterEach(async () => {
        await vi.runOnlyPendingTimersAsync();
        preferencesStore.trySet(defaultPreferences);
        vi.restoreAllMocks();
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

        expect(mocks.detectTransientsForClip).toHaveBeenCalledOnce();
        expect(mocks.detectTransientsForClip).toHaveBeenCalledWith('clip-1', 0.5);
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

    it('targets the displayed selected audio without pinning the editor open', async () => {
        select('clip-1');
        const pending = setElasticSensitivity(0.82);
        await vi.advanceTimersByTimeAsync(150);
        await pending;
        expect(mocks.detectTransientsForClip).toHaveBeenCalledExactlyOnceWith('clip-1', 0.82);
        expect(elasticAudioStore.value?.openClipId).toBeNull();
        expect(elasticAudioStore.value?.detected).toBe(true);
    });

    it('keeps an explicitly opened audio target when an unrelated selection changes', async () => {
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
        select('clip-2');
        const pending = setElasticSensitivity(0.6);
        select(null);
        await vi.advanceTimersByTimeAsync(150);
        await pending;
        expect(mocks.detectTransientsForClip).toHaveBeenCalledExactlyOnceWith('clip-1', 0.6);
    });

    it.each(['missing', 'midi', 'no-buffer'] as const)(
        'keeps %s targets preference-only without falling through',
        async (kind) => {
            select('clip-2');
            const opened = kind === 'missing' ? 'missing' : 'clip-1';
            elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: opened });
            if (kind !== 'missing') {
                const state = trackStore.value;
                if (!state) throw new Error('Track fixture missing');
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id !== opened
                                ? clip
                                : {
                                      ...clip,
                                      type: kind === 'midi' ? 'midi' : 'audio',
                                      audioBufferId: undefined,
                                  }
                        ),
                    })),
                });
            }
            const pending = setElasticSensitivity(0.7);
            await vi.advanceTimersByTimeAsync(150);
            await pending;
            expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.7);
            expect(mocks.detectTransientsForClip).not.toHaveBeenCalled();
            expect(elasticAudioStore.value?.detected).toBe(false);
        }
    );

    it('does not acquire a later selection from a preference-only gesture', async () => {
        const pending = setElasticSensitivity(0.82);
        select('clip-1');
        await vi.advanceTimersByTimeAsync(150);
        await pending;
        expect(mocks.detectTransientsForClip).not.toHaveBeenCalled();
    });

    it.each(['selection', 'selection-ABA', 'editor-ABA', 'source', 'source-ABA', 'root'] as const)(
        'retires a pending %s owner and permits a fresh valid gesture',
        async (change) => {
            select('clip-1');
            const pending = setElasticSensitivity(0.8);
            const original = trackStore.value;
            if (!original) throw new Error('Track fixture missing');
            if (change === 'selection' || change === 'selection-ABA') select('clip-2');
            if (change === 'selection-ABA') select('clip-1');
            if (change === 'editor-ABA') {
                elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: 'clip-1' });
                elasticAudioStore.set(defaultElasticAudioState);
            }
            if (change === 'source' || change === 'source-ABA') {
                trackStore.set({
                    ...original,
                    tracks: original.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) => ({ ...clip, audioBufferId: 'replacement' })),
                    })),
                });
                if (change === 'source-ABA') trackStore.set(original);
            }
            if (change === 'root') rootIdentity = 'replacement-root-with-same-project-and-clip-ids';
            await vi.advanceTimersByTimeAsync(150);
            await pending;
            expect(mocks.detectTransientsForClip).not.toHaveBeenCalled();
            expect(elasticAudioStore.value?.detected).toBe(false);
            trackStore.set(original);
            select('clip-1');
            const fresh = setElasticSensitivity(0.4);
            await vi.advanceTimersByTimeAsync(150);
            await fresh;
            expect(mocks.detectTransientsForClip).toHaveBeenCalledExactlyOnceWith('clip-1', 0.4);
        }
    );

    it('refuses a same-ID decoded buffer replacement', async () => {
        select('clip-1');
        const pending = setElasticSensitivity(0.8);
        buffer = makeBuffer();
        await vi.advanceTimersByTimeAsync(150);
        await pending;
        expect(mocks.detectTransientsForClip).not.toHaveBeenCalled();
    });

    it('settles coalesced callers and releases each actual subscription once', async () => {
        const disposals: ReturnType<typeof vi.fn>[] = [];
        const record = (unsubscribe: () => void) => {
            const dispose = vi.fn(unsubscribe);
            disposals.push(dispose);
            return dispose;
        };
        const elasticSubscribe = elasticAudioStore.subscribe.bind(elasticAudioStore);
        const selectionSubscribe = clipSelectionStore.subscribe.bind(clipSelectionStore);
        const trackSubscribe = trackStore.subscribe.bind(trackStore);
        vi.spyOn(elasticAudioStore, 'subscribe').mockImplementation((callback) => record(elasticSubscribe(callback)));
        vi.spyOn(clipSelectionStore, 'subscribe').mockImplementation((callback) =>
            record(selectionSubscribe(callback))
        );
        vi.spyOn(trackStore, 'subscribe').mockImplementation((callback) => record(trackSubscribe(callback)));
        select('clip-1');
        const first = setElasticSensitivity(0.1);
        const second = setElasticSensitivity(0.9);
        expect(second).toBe(first);
        await vi.advanceTimersByTimeAsync(150);
        await Promise.all([first, second]);
        expect(disposals).toHaveLength(6);
        for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports unexpected detection failure and settles without a rejected fire-and-forget promise', async () => {
        select('clip-1');
        const error = new Error('native detector failed');
        mocks.detectTransientsForClip.mockImplementationOnce(() => {
            throw error;
        });
        const pending = setElasticSensitivity(0.8);
        await vi.advanceTimersByTimeAsync(150);
        await expect(pending).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(error);
        expect(mocks.notify).toHaveBeenCalledExactlyOnceWith('Transient detection failed. Try again.', 'error');
        expect(elasticAudioStore.value?.detected).toBe(false);
        const fresh = setElasticSensitivity(0.4);
        await vi.advanceTimersByTimeAsync(150);
        await fresh;
        expect(elasticAudioStore.value?.detected).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not mark a refused detector result as detected success', async () => {
        select('clip-1');
        mocks.detectTransientsForClip.mockReturnValueOnce({ ok: false, reason: 'NO_BUFFER' });
        const pending = setElasticSensitivity(0.8);
        await vi.advanceTimersByTimeAsync(150);
        await pending;
        expect(elasticAudioStore.value?.detected).toBe(false);
        expect(mocks.notify).toHaveBeenCalledTimes(1);
    });
});
