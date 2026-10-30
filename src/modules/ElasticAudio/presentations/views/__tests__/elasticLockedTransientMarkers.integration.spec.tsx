import { toJS } from '@automerge/automerge';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    getWarpState,
    setWarpState,
    trackStore,
    warpStateStore,
} from '#/modules/Arrangement/stores';
import { createTrack, updateWarpMarkerBeat } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getFinalFeatureHandlers } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import {
    captureProjectRootIdentity,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { resetPreferences } from '#/modules/Preferences/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { detectTransients } from '../../../useCases/elasticAudio/detectTransients';
import { detectTransientsForClip } from '../../../useCases/elasticAudio/detectTransientsForClip';
import { setElasticSensitivityRootIdentityCapture } from '../../../useCases/elasticAudio/elasticSensitivityDependencies';
import { openElasticEditor } from '../../../useCases/elasticAudio/openElasticEditor';
import { setElasticSensitivity } from '../../../useCases/elasticAudio/setElasticSensitivity';
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
const selectedUserMarker: WarpState['markers'][number] = {
    id: 'selected-user',
    originalBeat: 0.9,
    warpedBeat: 1.2,
    origin: 'user',
    locked: false,
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
        resetPreferences();
        configureAutomergeStoragePort(null);
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setElasticSensitivityRootIdentityCapture(captureProjectRootIdentity);
        clearHandlerRegistry();
        clearUndoHistory();
        clipSelectionStore.set(defaultClipSelectionState);
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
        resetPreferences();
        cleanup();
        vi.restoreAllMocks();
        clearHandlerRegistry();
        clearUndoHistory();
        elasticAudioStore.set(defaultElasticAudioState);
        clipSelectionStore.set(defaultClipSelectionState);
        trackStore.set({ tracks: [], selectedTrackId: null });
        warpStateStore.set({ states: {} });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['explicitly-open', 'selected-only'] as const)(
        'changes real marker source from sensitivity with an %s audio target',
        async (mode) => {
            if (mode === 'selected-only') {
                elasticAudioStore.set(defaultElasticAudioState);
                clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: CLIP_ID });
            }
            const samples = burstSamples();
            const original = samples.slice();
            supplyBuffer(samples);
            setWarpState(CLIP_ID, { ...getWarpState(CLIP_ID), markers: [lockedMarker, selectedUserMarker] });
            flushAutomergeStorageWrites();
            render(<ElasticEditorPanel />);
            const slider = screen.getByRole('slider', { name: 'Transient detection sensitivity' });
            expect(slider).toBeVisible();
            expect(rawWarpState().markers).toEqual([lockedMarker, selectedUserMarker]);
            fireEvent.keyDown(slider, { key: 'End' });
            await waitFor(() => expect(rawWarpState().markers.length).toBeGreaterThan(2));
            flushAutomergeStorageWrites();
            expect(rawWarpState().markers).toEqual(getWarpState(CLIP_ID).markers);
            expect(rawWarpState().markers.find((marker) => marker.id === lockedMarker.id)).toEqual(lockedMarker);
            expect(rawWarpState().markers.find((marker) => marker.id === selectedUserMarker.id)).toEqual(
                selectedUserMarker
            );
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(samples).toEqual(original);
            expect(elasticAudioStore.value?.openClipId).toBe(mode === 'selected-only' ? null : CLIP_ID);
        }
    );

    it.each(['selection-ABA', 'root-replacement', 'preference-root-replacement'] as const)(
        'preserves real native rows when the pending %s owner expires',
        async (change) => {
            vi.useFakeTimers();
            try {
                const samples = burstSamples();
                const original = samples.slice();
                expect(detectTransients(samples, SAMPLE_RATE, 0.4).length).toBeGreaterThan(0);
                supplyBuffer(samples);
                setWarpState(CLIP_ID, { ...getWarpState(CLIP_ID), markers: [lockedMarker, selectedUserMarker] });
                flushAutomergeStorageWrites();
                elasticAudioStore.set(defaultElasticAudioState);
                clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: CLIP_ID });
                render(<ElasticEditorPanel />);
                expect(screen.getByRole('slider', { name: 'Transient detection sensitivity' })).toBeVisible();
                const replaceRoot = (): void => {
                    const tracks = trackStore.value;
                    if (!tracks) {
                        throw new Error('Original track fixture missing');
                    }
                    const warp = getWarpState(CLIP_ID);
                    createCrdtDoc('root');
                    trackStore.set({
                        ...tracks,
                        tracks: tracks.tracks.map((track) => ({ ...track, name: 'Successor' })),
                    });
                    setWarpState(CLIP_ID, {
                        ...warp,
                        markers: [{ ...lockedMarker, id: 'successor-root-locked' }, selectedUserMarker],
                    });
                    flushAutomergeStorageWrites();
                };
                const unsubscribe =
                    change === 'preference-root-replacement' ? preferencesStore.subscribe(replaceRoot) : undefined;
                const pending = setElasticSensitivity(0.9);
                unsubscribe?.();
                if (change === 'selection-ABA') {
                    act(() => {
                        clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: 'other-clip' });
                        clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: CLIP_ID });
                    });
                } else if (change === 'root-replacement') {
                    replaceRoot();
                }
                const root = getCrdtDoc('root');
                if (!root) {
                    throw new Error('Root fixture missing');
                }
                const before = toJS(root);
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(150);
                    await pending;
                });
                flushAutomergeStorageWrites();
                expect(getCrdtDoc('root')).toEqual(before);
                expect(elasticAudioStore.value?.detected).toBe(false);
                expect(samples).toEqual(original);
                const fresh = setElasticSensitivity(0.4);
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(150);
                    await fresh;
                });
                expect(getWarpState(CLIP_ID).markers.length).toBeGreaterThan(2);
                flushAutomergeStorageWrites();
                expect(rawWarpState().markers.length).toBeGreaterThan(2);
                expect(rawWarpState().markers).toEqual(getWarpState(CLIP_ID).markers);
                expect(samples).toEqual(original);
            } finally {
                vi.useRealTimers();
            }
        }
    );

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

        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(0.51);
        expect(elasticAudioStore.value?.detected).toBe(false);
        await waitFor(() => expect(elasticAudioStore.value?.detected).toBe(true));
        flushAutomergeStorageWrites();
        expect(rawWarpState().markers).toEqual([lockedMarker]);
        expect(getWarpState(CLIP_ID).markers).toEqual([lockedMarker]);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 1 locked');
        expect(samples).toEqual(new Float32Array(SAMPLE_RATE));
    });

    it('reflects the completed sensitivity detection without another gesture', async () => {
        const samples = new Float32Array(SAMPLE_RATE * 3);
        for (const [attack, amplitude] of [14000, 2000, 14000, 3000, 14000].entries()) {
            const start = Math.floor(SAMPLE_RATE * (0.25 + attack * 0.4));
            for (let frame = 0; frame < 2205; frame++) {
                samples[start + frame] =
                    (amplitude / 32768) *
                    Math.sin((2 * Math.PI * 1000 * frame) / SAMPLE_RATE) *
                    Math.exp((-6 * frame) / 2205);
            }
        }
        const originalSamples = samples.slice();
        supplyBuffer(samples);
        const context = document.createElement('canvas').getContext('2d');
        if (!context) {
            throw new Error('Canvas context unavailable');
        }
        const moveTo = vi.spyOn(context, 'moveTo');
        render(<ElasticEditorPanel />);
        const slider = screen.getByRole('slider', { name: 'Transient detection sensitivity' });
        fireEvent.keyDown(slider, { key: 'Home' });
        await waitFor(() => expect(elasticAudioStore.value?.detected).toBe(true));
        const lowCount = getWarpState(CLIP_ID).markers.length;
        expect(lowCount).toBeGreaterThan(1);
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent(
            `${lowCount} transients, 0 user, 1 locked`
        );

        const lowIds = new Set(getWarpState(CLIP_ID).markers.map((marker) => marker.id));
        moveTo.mockClear();
        fireEvent.keyDown(slider, { key: 'End' });
        await waitFor(() => expect(getWarpState(CLIP_ID).markers.length).toBeGreaterThan(lowCount));
        const highCount = getWarpState(CLIP_ID).markers.length;
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent(
            `${highCount} transients, 0 user, 1 locked`
        );
        const markers = getWarpState(CLIP_ID).markers;
        const added = markers.find(
            (marker) =>
                !lowIds.has(marker.id) &&
                markers.every(
                    (other) => other.id === marker.id || Math.abs(other.warpedBeat - marker.warpedBeat) * 40 >= 8
                )
        );
        expect(added).toBeDefined();
        if (!added) {
            throw new Error('No separately hittable new marker');
        }
        const x = added.warpedBeat * 40;
        await waitFor(() => expect(moveTo).toHaveBeenCalledWith(x, 0));
        const canvas = screen.getByTestId('elastic-waveform-canvas');
        canvas.setPointerCapture = vi.fn();
        fireEvent.pointerDown(canvas, { clientX: x, pointerId: 4 });
        expect(elasticAudioStore.value?.selectedMarkerIds).toEqual([added.id]);
        flushAutomergeStorageWrites();
        expect(rawWarpState().markers).toEqual(getWarpState(CLIP_ID).markers);
        expect(rawWarpState().markers).toContainEqual(lockedMarker);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
        expect(samples).toEqual(originalSamples);
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

        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('2 transients, 2 user, 1 locked');
        try {
            await act(async () => {
                await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID, sensitivity: 0.5 } });
                await eventBus.waitForIdle();
            });
        } finally {
            unsubscribe();
        }
        flushAutomergeStorageWrites();

        const expectedMarkers = [...retained].sort((a, b) => a.originalBeat - b.originalBeat);
        expect(rawWarpState().markers).toEqual(expectedMarkers);
        expect(getWarpState(CLIP_ID).markers).toEqual(expectedMarkers);
        expect(notices).toEqual([{ message: 'Detected 0 transients (4 preserved)', level: 'success' }]);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 2 user, 1 locked');
        act(() => openElasticEditor('other-clip'));
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 1 locked');
        act(() => openElasticEditor(CLIP_ID));
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
