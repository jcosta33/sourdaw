import { change, clone } from '@automerge/automerge';
import * as storageRuntime from '#/infra/store/storage/createAutomergeStorage';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getWarpState, setWarpState, trackStore, warpStateStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, updateWarpMarkerBeat } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getFinalFeatureHandlers } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, undo, redo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
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
import { detectTransients } from '../../../models/TransientDetection';
import {
    type TransientOnsetWorkerRequest,
    type TransientOnsetWorkerResult,
} from '../../../models/TransientOnsetWorker';
import { openElasticEditor } from '../../../useCases/elasticAudio/openElasticEditor';
import { addManualMarker } from '../../../useCases/elasticAudio/addManualMarker';
import { toggleMarkerLock } from '../../../useCases/elasticAudio/toggleMarkerLock';
import { ElasticEditorPanel } from '../ElasticEditorPanel';

const worker = vi.hoisted(() =>
    vi.fn<(input: TransientOnsetWorkerRequest & { signal?: AbortSignal }) => Promise<TransientOnsetWorkerResult>>()
);
vi.mock('../../../repositories/transientOnsetWorkerClient', () => ({ runTransientOnsetWorker: worker }));

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
        resetPreferences();
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        injectDependencies(notifyUser, { eventBus: bus });
        configureAutomergeStoragePort(null);
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        registerHandlerMap({ ...getArrangementHandlers(), ...getFinalFeatureHandlers() });
        projectStore.set({ ...defaultProjectStoreState, initialized: true, loading: false });
        worker.mockImplementation(async ({ channels, sampleRate, sensitivity }) => {
            const copied = structuredClone(channels, {
                transfer: channels.map((channel) => channel.buffer as ArrayBuffer),
            });
            const mono = new Float32Array(copied[0]!.length);
            for (let i = 0; i < mono.length; i++)
                mono[i] = copied.reduce((sum, channel) => sum + channel[i]!, 0) / copied.length;
            return { status: 'complete', hits: detectTransients(mono, sampleRate, sensitivity) };
        });
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
        trackStore.set({ tracks: [], selectedTrackId: null });
        warpStateStore.set({ states: {} });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('Detect preserves the edited locked automatic row in raw CRDT, store and visible count', async () => {
        const samples = new Float32Array(SAMPLE_RATE);
        const buffer = makeBuffer(samples);
        const originalTracks = structuredClone(trackStore.value?.tracks);
        vi.spyOn(audioBufferCache, 'get').mockImplementation((id) => (id === BUFFER_ID ? buffer : undefined));
        expect(rawWarpState().markers).toEqual([lockedMarker]);
        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 1 locked');

        fireEvent.click(screen.getByRole('button', { name: 'Detect' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Detection complete'));
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
        injectDependencies(notifyUser, { eventBus });
        const unsubscribe = eventBus.on('ui.notify', (notice) => {
            notices.push(notice);
        });

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
        async (offset) => {
            const samples = burstSamples();
            const originalPcm = samples.slice();
            supplyBuffer(samples);
            setWarpState(CLIP_ID, { ...getWarpState(CLIP_ID), markers: [] });
            await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID, sensitivity: 0.5 } });
            expect(getWarpState(CLIP_ID).markers).toHaveLength(1);
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
            await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Detection complete'));
            flushAutomergeStorageWrites();

            expect(rawWarpState().markers).toEqual([retained]);
            expect(getWarpState(CLIP_ID).markers).toEqual([retained]);
            expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 0 user, 1 locked');
            act(() => toggleMarkerLock(CLIP_ID, first.id));
            fireEvent.click(screen.getByRole('button', { name: 'Detect' }));
            await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Detection complete'));
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
    it('captures the inverse after the Worker and keeps concurrent edits through real Undo and Redo', async () => {
        supplyBuffer(burstSamples());
        let finish: ((result: TransientOnsetWorkerResult) => void) | undefined;
        const started = new Promise<void>((resolve) =>
            worker.mockImplementationOnce(() => {
                resolve();
                return new Promise((done) => {
                    finish = done;
                });
            })
        );
        const execution = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        await started;
        setWarpState(CLIP_ID, {
            ...getWarpState(CLIP_ID),
            markers: [
                ...getWarpState(CLIP_ID).markers,
                { id: 'during-worker', originalBeat: 1.5, warpedBeat: 1.7, origin: 'user' },
            ],
        });
        flushAutomergeStorageWrites();
        const before = structuredClone(getWarpState(CLIP_ID));
        finish?.({ status: 'complete', hits: [{ sampleOffset: 1024, confidence: 1 }] });
        await execution;
        const after = structuredClone(getWarpState(CLIP_ID));
        expect(after.markers).toContainEqual(lockedMarker);
        expect(after.markers).toContainEqual(before.markers[1]);
        expect(after.markers).toHaveLength(3);
        expect(rawWarpState()).toEqual(after);
        await undo();
        expect(rawWarpState()).toEqual(before);
        expect(getWarpState(CLIP_ID)).toEqual(before);
        await redo();
        expect(rawWarpState()).toEqual(after);
        expect(getWarpState(CLIP_ID)).toEqual(after);
        setWarpState(CLIP_ID, {
            ...after,
            markers: [...after.markers, { id: 'later-user', originalBeat: 1.9, warpedBeat: 1.9, origin: 'user' }],
        });
        flushAutomergeStorageWrites();
        const diverged = structuredClone(rawWarpState());
        const outcome = await undo();
        expect(outcome.headConsumed).toBe(false);
        expect(rawWarpState()).toEqual(diverged);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
    });

    it('rejects a cancelled Worker result with no raw document write and permits retry', async () => {
        supplyBuffer(burstSamples());
        let finish: ((result: TransientOnsetWorkerResult) => void) | undefined;
        const started = new Promise<void>((resolve) =>
            worker.mockImplementationOnce(() => {
                resolve();
                return new Promise((done) => {
                    finish = done;
                });
            })
        );
        const controller = new AbortController();
        const before = JSON.stringify(getCrdtDoc('root'));
        const execution = executeAppAction(
            { type: 'detectTransients', payload: { clipId: CLIP_ID } },
            { signal: controller.signal }
        );
        const rejected = expect(execution).rejects.toThrow(/cancelled|changed/);
        await started;
        controller.abort();
        finish?.({ status: 'complete', hits: [{ sampleOffset: 512, confidence: 1 }] });
        await rejected;
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(before);
        await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        expect(getWarpState(CLIP_ID).markers.length).toBeGreaterThan(1);
    });
    it('aborts a scoped post-await write while preserving a separately committed command', async () => {
        supplyBuffer(burstSamples());
        let finish: ((result: TransientOnsetWorkerResult) => void) | undefined;
        const started = new Promise<void>((resolve) =>
            worker.mockImplementationOnce(() => {
                resolve();
                return new Promise((done) => {
                    finish = done;
                });
            })
        );
        const controller = new AbortController();
        const execution = executeAppAction(
            { type: 'detectTransients', payload: { clipId: CLIP_ID } },
            { signal: controller.signal }
        );
        const refused = expect(execution).rejects.toThrow(
            'Action conflicts with current project state: detectTransients'
        );
        await started;
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'audio-track', name: 'Independent edit' } });
        const original = warpStateStore.set.bind(warpStateStore);
        const setter = vi.spyOn(warpStateStore, 'set').mockImplementationOnce((value) => {
            original(value);
            controller.abort();
        });
        const before = JSON.stringify(getCrdtDoc('root'));
        finish?.({ status: 'complete', hits: [{ sampleOffset: 1024, confidence: 1 }] });
        await refused;
        expect(setter).toHaveBeenCalledOnce();
        setter.mockRestore();
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(before);
        expect(getWarpState(CLIP_ID).markers).toEqual([lockedMarker]);
        expect(trackStore.value?.tracks[0]?.name).toBe('Independent edit');
        await undo();
        expect(trackStore.value?.tracks[0]?.name).toBe('Audio');
        expect(getWarpState(CLIP_ID).markers).toEqual([lockedMarker]);
    });

    it('refuses Undo rather than replacing a later unrelated clip marker', async () => {
        supplyBuffer(burstSamples());
        await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        setWarpState('other-clip', {
            ...otherWarpState,
            markers: [
                ...otherWarpState.markers,
                { id: 'unrelated-later', originalBeat: 3, warpedBeat: 4, origin: 'user' },
            ],
        });
        flushAutomergeStorageWrites();
        const before = JSON.stringify(getCrdtDoc('root'));
        expect((await undo()).headConsumed).toBe(false);
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(before);
        expect(getWarpState('other-clip').markers).toContainEqual({
            id: 'unrelated-later',
            originalBeat: 3,
            warpedBeat: 4,
            origin: 'user',
        });
    });
    it('registered sensitivity awaits its child command without capturing independent writes', async () => {
        supplyBuffer(burstSamples());
        let finish: ((result: TransientOnsetWorkerResult) => void) | undefined;
        const started = new Promise<void>((resolve) =>
            worker.mockImplementationOnce(() => {
                resolve();
                return new Promise((done) => {
                    finish = done;
                });
            })
        );
        let settled = false;
        const execution = executeAppAction({ type: 'elasticSetSensitivity', payload: { sensitivity: 0.82 } }).then(
            () => {
                settled = true;
            }
        );
        await started;
        expect(settled).toBe(false);
        expect(elasticAudioStore.value?.detected).toBe(false);
        await executeAppAction({
            type: 'renameTrack',
            payload: { trackId: 'audio-track', name: 'During sensitivity' },
        });
        finish?.({ status: 'complete', hits: [{ sampleOffset: 1024, confidence: 1 }] });
        await execution;
        expect(elasticAudioStore.value?.detected).toBe(true);
        expect(rawWarpState().markers).toEqual(getWarpState(CLIP_ID).markers);
        expect(getWarpState(CLIP_ID).markers).toContainEqual(lockedMarker);
        await undo();
        expect(getWarpState(CLIP_ID).markers).toEqual([lockedMarker]);
        expect(trackStore.value?.tracks[0]?.name).toBe('During sensitivity');
        await undo();
        expect(trackStore.value?.tracks[0]?.name).toBe('Audio');
    });
    it.each(['reject', 'reenter'] as const)(
        'materialized candidate %s keeps independent history and live authority',
        async (mode) => {
            supplyBuffer(burstSamples());
            await executeAppAction({
                type: 'renameTrack',
                payload: { trackId: 'audio-track', name: 'Independent rename' },
            });
            const history = JSON.stringify(undoHistoryStore.value);
            const observePort = vi.spyOn(storageRuntime, 'configureAutomergeStoragePort');
            registerCrdtStorageRuntime();
            const port = observePort.mock.calls.at(-1)?.[0];
            observePort.mockRestore();
            if (!port?.mutateDocValidated) throw new Error('Production runtime must provide prospective validation');
            const mutateValidated = port.mutateDocValidated;
            configureAutomergeStoragePort({
                ...port,
                mutateDocValidated: (input) =>
                    mutateValidated({
                        ...input,
                        validateDocument: (candidate) => {
                            input.validateDocument(candidate);
                            if (mode === 'reject') throw new Error('materialized candidate refused');
                            const current = getCrdtDoc<{ tracks: { tracks: ReturnType<typeof createTrack>[] } }>(
                                'root'
                            );
                            if (!current) throw new Error('Expected live project');
                            replaceCrdtDocInLineage({
                                id: 'root',
                                doc: change(clone(current), (draft) => {
                                    const track = draft.tracks.tracks[0];
                                    if (!track) throw new Error('Expected audio track');
                                    track.name = 'Reentrant rename';
                                }),
                            });
                        },
                    }),
            });
            await expect(executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } })).rejects.toThrow(
                /materialized candidate refused|authority changed/
            );
            expect(JSON.stringify(undoHistoryStore.value)).toBe(history);
            expect(rawWarpState().markers).toEqual([lockedMarker]);
            expect(getWarpState(CLIP_ID).markers).toEqual([lockedMarker]);
            const raw = getCrdtDoc<{ tracks: { tracks: ReturnType<typeof createTrack>[] } }>('root');
            expect(raw?.tracks.tracks[0]?.name).toBe(mode === 'reenter' ? 'Reentrant rename' : 'Independent rename');
            configureAutomergeStoragePort(port);
            await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
            expect(rawWarpState().markers.length).toBeGreaterThan(1);
            expect(rawWarpState().markers).toEqual(getWarpState(CLIP_ID).markers);
            expect(rawWarpState().markers).toContainEqual(lockedMarker);
        }
    );
    it('retains the exact durable shape of markers produced by the real manual-marker owner', async () => {
        supplyBuffer(burstSamples());
        addManualMarker(CLIP_ID, 1.5);
        flushAutomergeStorageWrites();
        const retained = structuredClone(getWarpState(CLIP_ID).markers);
        await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        for (const marker of retained) expect(rawWarpState().markers).toContainEqual(marker);
        expect(rawWarpState().markers).toEqual(getWarpState(CLIP_ID).markers);
    });
});
