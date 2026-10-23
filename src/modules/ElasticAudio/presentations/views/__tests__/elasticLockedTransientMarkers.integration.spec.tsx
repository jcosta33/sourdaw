import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getWarpState, setWarpState, trackStore, warpStateStore } from '#/modules/Arrangement/stores';
import { createTrack, updateWarpMarkerBeat } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getFinalFeatureHandlers } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import { createCrdtDoc, getCrdtDoc, registerCrdtStorageRuntime, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { detectTransientsForClip } from '../../../useCases/elasticAudio/detectTransientsForClip';
import { openElasticEditor } from '../../../useCases/elasticAudio/openElasticEditor';
import { toggleMarkerLock } from '../../../useCases/elasticAudio/toggleMarkerLock';
import { ElasticEditorPanel } from '../ElasticEditorPanel';

type WarpState = Parameters<typeof setWarpState>[1];

const CLIP_ID = 'locked-transient-clip';
const BUFFER_ID = 'locked-transient-buffer';
const SAMPLE_RATE = 44100;
const lockedMarker: WarpState['markers'][number] = {
    id: 'edited-locked-auto',
    originalBeat: 0.8,
    warpedBeat: 1.1,
    origin: 'transient-auto',
    confidence: 0.73,
    locked: true,
};
const otherWarpState: WarpState = {
    enabled: true,
    markers: [{ ...lockedMarker, id: 'other-locked-auto', warpedBeat: 1.6 }],
    stretchMode: 'repitch',
    originalTempo: 90,
};

function supplyBuffer(samples: Float32Array<ArrayBuffer>): void {
    const buffer = makeBuffer(samples);
    // Decoded PCM is the I/O fixture; detection, stores and the view remain real.
    vi.spyOn(audioBufferCache, 'get').mockImplementation((id) => (id === BUFFER_ID ? buffer : undefined));
}

function burstSamples(): Float32Array<ArrayBuffer> {
    const samples = new Float32Array(SAMPLE_RATE);
    const start = SAMPLE_RATE / 4;
    for (let i = 0; i < 220; i++) {
        samples[start + i] = Math.sin((2 * Math.PI * 997 * i) / SAMPLE_RATE) * Math.exp(-i / 50);
    }
    return samples;
}

function makeBuffer(samples: Float32Array<ArrayBuffer>): AudioBuffer {
    return {
        length: samples.length,
        duration: samples.length / SAMPLE_RATE,
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        getChannelData: () => samples,
        copyFromChannel: (destination, _channel, start = 0) => {
            destination.set(samples.subarray(start, start + destination.length));
        },
        copyToChannel: (source, _channel, start = 0) => {
            samples.set(source, start);
        },
    };
}

function rawWarpState(clipId = CLIP_ID): WarpState {
    const doc = getCrdtDoc<{ warpStates: { states: Record<string, WarpState> } }>('root');
    const state = doc?.warpStates.states[clipId];
    if (!state) {
        throw new Error(`Missing real CRDT warp state for ${clipId}`);
    }
    return state;
}

describe('locked transient markers through the real Elastic editor', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        const track = createTrack({ id: 'audio-track', name: 'Audio', kind: 'audio', withoutDefaultDevice: true });
        trackStore.set({
            tracks: [
                {
                    ...track,
                    clips: [CLIP_ID, 'other-clip'].map((id): ReturnType<typeof createTrack>['clips'][number] => ({
                        id,
                        trackId: track.id,
                        name: 'Loop',
                        startBeat: 0,
                        endBeat: 2,
                        type: 'audio',
                        audioBufferId: id === CLIP_ID ? BUFFER_ID : 'other-buffer',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#336699',
                        locked: false,
                        muted: false,
                    })),
                },
            ],
            selectedTrackId: track.id,
        });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        elasticAudioStore.set(defaultElasticAudioState);
        openElasticEditor(CLIP_ID);
        setWarpState(CLIP_ID, {
            enabled: true,
            markers: [lockedMarker],
            stretchMode: 'repitch',
            originalTempo: 120,
        });
        setWarpState('other-clip', otherWarpState);
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        clearHandlerRegistry();
        clearUndoHistory();
        elasticAudioStore.set(defaultElasticAudioState);
        trackStore.set({ tracks: [], selectedTrackId: null });
        warpStateStore.set({ states: {} });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('Detect preserves the edited locked automatic row in raw CRDT, store and visible count', () => {
        const samples = new Float32Array(SAMPLE_RATE);
        const buffer = makeBuffer(samples);
        const originalTracks = structuredClone(trackStore.value?.tracks);
        vi.spyOn(audioBufferCache, 'get').mockImplementation((id) => (id === BUFFER_ID ? buffer : undefined));
        expect(rawWarpState().markers).toEqual([lockedMarker]);
        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 1 locked');

        fireEvent.click(screen.getByRole('button', { name: 'Detect' }));
        flushAutomergeStorageWrites();

        expect(rawWarpState().markers).toEqual([lockedMarker]);
        expect(getWarpState(CLIP_ID).markers).toEqual([lockedMarker]);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
        expect(getWarpState('other-clip')).toEqual(otherWarpState);
        expect(getCrdtDoc<{ tracks: { tracks: ReturnType<typeof createTrack>[] } }>('root')?.tracks.tracks).toEqual(
            originalTracks
        );
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 1 locked');
        expect(samples).toEqual(new Float32Array(SAMPLE_RATE));
    });

    it('preserves the same raw row after the real sensitivity slider debounce completes', async () => {
        const samples = new Float32Array(SAMPLE_RATE);
        supplyBuffer(samples);
        render(<ElasticEditorPanel />);
        expect(elasticAudioStore.value?.detected).toBe(false);

        fireEvent.keyDown(screen.getByRole('slider', { name: 'Transient detection sensitivity' }), {
            key: 'ArrowRight',
        });

        expect(elasticAudioStore.value?.sensitivity).toBe(0.51);
        expect(elasticAudioStore.value?.detected).toBe(false);
        await waitFor(() => expect(elasticAudioStore.value?.detected).toBe(true));
        flushAutomergeStorageWrites();
        expect(rawWarpState().markers).toEqual([lockedMarker]);
        expect(getWarpState(CLIP_ID).markers).toEqual([lockedMarker]);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 1 locked');
        expect(samples).toEqual(new Float32Array(SAMPLE_RATE));
    });

    it('the registered typed command reports the real kept set and preserves all retained fields', async () => {
        const samples = new Float32Array(SAMPLE_RATE);
        supplyBuffer(samples);
        const retained: WarpState['markers'] = [
            lockedMarker,
            { id: 'user', originalBeat: 1.3, warpedBeat: 1.5, origin: 'user' },
            { id: 'grid', originalBeat: 0.5, warpedBeat: 0.4, origin: 'grid-snap', locked: false },
            { id: 'legacy', originalBeat: 0.1, warpedBeat: 0.2 },
        ];
        setWarpState(CLIP_ID, {
            ...getWarpState(CLIP_ID),
            markers: [
                ...retained,
                { id: 'replaceable-auto', originalBeat: 0.3, warpedBeat: 0.6, origin: 'transient-auto', locked: false },
            ],
        });
        flushAutomergeStorageWrites();
        const notices: NotifyPayload[] = [];
        const eventBus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        setNotificationEventBus(eventBus);
        const unsubscribe = eventBus.on('ui.notify', (notice) => {
            notices.push(notice);
        });
        registerHandlerMap({ detectTransients: getFinalFeatureHandlers().detectTransients });

        try {
            await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID, sensitivity: 0.5 } });
            await eventBus.waitForIdle();
        } finally {
            unsubscribe();
        }
        flushAutomergeStorageWrites();

        const expectedMarkers = [...retained].sort((a, b) => a.originalBeat - b.originalBeat);
        expect(rawWarpState().markers).toEqual(expectedMarkers);
        expect(getWarpState(CLIP_ID).markers).toEqual(expectedMarkers);
        expect(notices).toEqual([{ message: 'Detected 0 transients (4 preserved)', level: 'success' }]);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 2 user, 1 locked');
        expect(samples).toEqual(new Float32Array(SAMPLE_RATE));
    });

    it.each([0, 0.0005])(
        'suppresses hits %s beats from a retained lock and replaces it after real unlock',
        (offset) => {
            const samples = burstSamples();
            const originalPcm = samples.slice();
            supplyBuffer(samples);
            setWarpState(CLIP_ID, { ...getWarpState(CLIP_ID), markers: [] });
            expect(detectTransientsForClip(CLIP_ID, 0.5)).toEqual({ ok: true, added: 1, kept: 0, removed: 0 });
            const first = getWarpState(CLIP_ID).markers[0];
            if (!first) {
                throw new Error('The deterministic burst must produce its real automatic marker');
            }
            updateWarpMarkerBeat({
                clipId: CLIP_ID,
                markerId: first.id,
                field: 'originalBeat',
                beat: first.originalBeat + offset,
            });
            updateWarpMarkerBeat({ clipId: CLIP_ID, markerId: first.id, field: 'warpedBeat', beat: 1.1 });
            toggleMarkerLock(CLIP_ID, first.id);
            const retained = structuredClone(getWarpState(CLIP_ID).markers[0]);
            expect(retained).toEqual({
                ...first,
                originalBeat: first.originalBeat + offset,
                warpedBeat: 1.1,
                locked: true,
            });
            flushAutomergeStorageWrites();
            render(<ElasticEditorPanel />);

            fireEvent.click(screen.getByRole('button', { name: 'Detect' }));
            flushAutomergeStorageWrites();

            expect(rawWarpState().markers).toEqual([retained]);
            expect(getWarpState(CLIP_ID).markers).toEqual([retained]);
            expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 1 locked');
            act(() => toggleMarkerLock(CLIP_ID, first.id));
            fireEvent.click(screen.getByRole('button', { name: 'Detect' }));
            flushAutomergeStorageWrites();

            const expectedReplacement = {
                ...first,
                id: expect.any(String),
                warpedBeat: first.originalBeat,
                locked: false,
            };
            expect(rawWarpState().markers).toEqual([expectedReplacement]);
            expect(getWarpState(CLIP_ID).markers).toEqual([expectedReplacement]);
            expect(getWarpState(CLIP_ID).markers[0]?.id).not.toBe(first.id);
            expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 0 locked');
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(samples).toEqual(originalPcm);
        }
    );
});
