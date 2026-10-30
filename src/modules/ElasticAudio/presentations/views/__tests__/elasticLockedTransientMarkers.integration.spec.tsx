import {
    change,
    clone,
    free,
    save,
    getActorId,
    getChangesMetaSince,
    getHeads,
    getObjectId,
    load,
    merge,
    toJS,
} from '@automerge/automerge';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createEventBus } from '#/infra/events/createEventBus';
import { applyCanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';
import * as storageRuntime from '#/infra/store/storage/createAutomergeStorage';
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
import { createTrack, getArrangementHandlers, updateWarpMarkerBeat } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getFinalFeatureHandlers } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, undo, redo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    captureProjectRootIdentity,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
} from '#/modules/CrdtDocument/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, resetPreferences } from '#/modules/Preferences/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { detectTransients } from '../../../models/TransientDetection';
import {
    type TransientOnsetWorkerRequest,
    type TransientOnsetWorkerResult,
} from '../../../models/TransientOnsetWorker';
import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { addManualMarker } from '../../../useCases/elasticAudio/addManualMarker';
import { setElasticSensitivityRootIdentityCapture } from '../../../useCases/elasticAudio/elasticSensitivityDependencies';
import { openElasticEditor } from '../../../useCases/elasticAudio/openElasticEditor';
import { setElasticRootIdentityProvider } from '../../../useCases/elasticAudio/setElasticRootIdentityProvider';
import { setElasticSensitivity } from '../../../useCases/elasticAudio/setElasticSensitivity';
import { toggleMarkerLock } from '../../../useCases/elasticAudio/toggleMarkerLock';
import { ElasticEditorPanel } from '../ElasticEditorPanel';

const worker = vi.hoisted(() =>
    vi.fn<(input: TransientOnsetWorkerRequest & { signal?: AbortSignal }) => Promise<TransientOnsetWorkerResult>>()
);
vi.mock('../../../repositories/transientOnsetWorkerClient', () => ({ runTransientOnsetWorker: worker }));
type MaterializationRequest = {
    seed: Uint8Array<ArrayBuffer>;
    heads: readonly string[];
    actor: string;
    message?: string;
    time?: number;
    mutation: Parameters<typeof applyCanonicalStorageSlotMutation>[1];
};
type MaterializationResult = { bytes: Uint8Array<ArrayBuffer>; heads: string[] };
const materialization = vi.hoisted(() =>
    vi.fn<(request: MaterializationRequest, signal: AbortSignal) => Promise<MaterializationResult>>()
);
class MaterializationWorker {
    static instances: MaterializationWorker[] = [];
    static recordedReceivingRealm = false;
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
    private readonly lifetime = new AbortController();
    lateErrors: unknown[] = [];
    completion: Promise<void> = Promise.resolve();
    terminated = false;
    terminate = vi.fn(() => {
        this.terminated = true;
        this.lifetime.abort();
    });

    constructor(url: URL, options: WorkerOptions) {
        expect(url.pathname).toMatch(/\/workers\/prospectiveMutationWorker\.ts$/);
        expect(options).toEqual({ type: 'module' });
        MaterializationWorker.instances.push(this);
    }

    postMessage(request: MaterializationRequest, transfer: Transferable[]): void {
        const received = structuredClone(request, { transfer });
        expect(request.seed.byteLength).toBe(0);
        this.completion = materialization(received, this.lifetime.signal)
            .then(
                (result) => {
                    const response = structuredClone(
                        { status: 'complete', ...result },
                        { transfer: [result.bytes.buffer] }
                    );
                    expect(result.bytes.byteLength).toBe(0);
                    if (!MaterializationWorker.recordedReceivingRealm) {
                        console.info('Controlled Worker host-clone receiving realm:', {
                            typedArray: response.bytes instanceof Uint8Array,
                            arrayBuffer: response.bytes.buffer instanceof ArrayBuffer,
                        });
                        MaterializationWorker.recordedReceivingRealm = true;
                    }
                    // Node's clone returns host-realm views; a browser message adopts the receiver's intrinsics.
                    const bytes = Uint8Array.from(response.bytes);
                    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
                    this.onmessage?.(new MessageEvent('message', { data: { ...response, bytes } }));
                },
                (error: unknown) => {
                    if (this.terminated) {
                        this.lateErrors.push(error);
                        return;
                    }
                    this.onmessage?.(
                        new MessageEvent('message', {
                            data: { status: 'failed', message: error instanceof Error ? error.message : String(error) },
                        })
                    );
                }
            )
            .catch((error: unknown) => {
                this.lateErrors.push(error);
                this.onerror?.(new Event('error'));
            });
    }
}

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

function expectCanonicalWarpAbsence(): void {
    const doc = getCrdtDoc<{ warpStates: { states: Record<string, WarpState> } }>('root');
    expect(doc?.warpStates.states[CLIP_ID]).toBeUndefined();
    expect(warpStateStore.value?.states[CLIP_ID]).toBeUndefined();
}

function holdAnimationFrames() {
    const callbacks: FrameRequestCallback[] = [];
    const waiters: ((callback: FrameRequestCallback) => void)[] = [];
    let handle = 0;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        const waiter = waiters.shift();
        if (waiter) {
            waiter(callback);
        } else {
            callbacks.push(callback);
        }
        return ++handle;
    });
    const cancelled = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    return {
        cancelled,
        complete: async (execution: Promise<void>): Promise<void> => {
            let settled = false;
            const finished = execution.then(() => {
                settled = true;
            });
            while (!settled) {
                const callback = callbacks.shift();
                let next: Promise<FrameRequestCallback>;
                if (callback) {
                    next = Promise.resolve(callback);
                } else {
                    next = new Promise<FrameRequestCallback>((resolve) => waiters.push(resolve));
                }
                const result = await Promise.race([next, finished]);
                if (result) {
                    result(performance.now());
                }
            }
            await finished;
        },
        next: (): Promise<FrameRequestCallback> => {
            const callback = callbacks.shift();
            return callback ? Promise.resolve(callback) : new Promise((resolve) => waiters.push(resolve));
        },
    };
}

describe('locked transient markers through the real Elastic editor', () => {
    beforeEach(() => {
        MaterializationWorker.instances = [];
        vi.stubGlobal('Worker', MaterializationWorker);
        materialization.mockReset();
        materialization.mockImplementation(async (request) => {
            // Only transport is substituted; the same canonical helper and native codec remain real.
            const seed = load<Record<string, unknown>>(request.seed, { actor: request.actor });
            const candidate = change(seed, { message: request.message }, (draft) =>
                applyCanonicalStorageSlotMutation(draft, request.mutation)
            );
            try {
                return {
                    bytes: Uint8Array.from(save(candidate)),
                    heads: getHeads(candidate),
                };
            } finally {
                free(candidate);
            }
        });
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
        setElasticRootIdentityProvider(captureProjectRootIdentity);
        setElasticSensitivityRootIdentityCapture(captureProjectRootIdentity);
        clipSelectionStore.set(defaultClipSelectionState);
        clearHandlerRegistry();
        clearUndoHistory();
        registerHandlerMap({ ...getArrangementHandlers(), ...getFinalFeatureHandlers() });
        projectStore.set({ ...defaultProjectStoreState, initialized: true, loading: false });
        worker.mockImplementation(async ({ channels, sampleRate, sensitivity }) => {
            const copied = structuredClone(channels, {
                transfer: channels.map((channel) => channel.buffer as ArrayBuffer),
            });
            const mono = new Float32Array(copied[0]!.length);
            for (let i = 0; i < mono.length; i++) {
                mono[i] = copied.reduce((sum, channel) => sum + channel[i]!, 0) / copied.length;
            }
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

    afterEach(async () => {
        for (const instance of MaterializationWorker.instances) {
            if (!instance.terminated) {
                instance.onerror?.(new Event('error'));
            }
            await instance.completion;
            expect(instance.terminated).toBe(true);
            expect(instance.onmessage).toBeNull();
            expect(instance.onerror).toBeNull();
            expect(instance.onmessageerror).toBeNull();
            expect(instance.lateErrors).toEqual([]);
        }
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
        setElasticRootIdentityProvider(null);
        setElasticSensitivityRootIdentityCapture(null);
        clipSelectionStore.set(defaultClipSelectionState);
        vi.unstubAllGlobals();
    });

    it.each(['Detect', 'sensitivity'] as const)(
        'review repair: completes silent absent state through %s without creating Undo history',
        async (route) => {
            const samples = new Float32Array(SAMPLE_RATE);
            supplyBuffer(samples);
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
            warpStateStore.set({ states: { 'other-clip': otherWarpState } });
            flushAutomergeStorageWrites();
            clearUndoHistory();
            const original = getCrdtDoc('root');
            if (!original) {
                throw new Error('Expected silent source root');
            }
            const heads = getHeads(original);
            const before = toJS(original);
            const projection = structuredClone(getWarpState(CLIP_ID));
            expect(detectTransients(samples, SAMPLE_RATE, 0.5)).toEqual([]);
            if (route === 'Detect') {
                await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID, sensitivity: 0.5 } });
            } else {
                await setElasticSensitivity(0.5);
                expect(elasticAudioStore.value?.detected).toBe(true);
            }
            const current = getCrdtDoc('root');
            if (!current) {
                throw new Error('Expected completed silent root');
            }
            expect(getHeads(current)).toEqual(heads);
            expect(toJS(current)).toEqual(before);
            expect(getWarpState(CLIP_ID)).toEqual(projection);
            expectCanonicalWarpAbsence();
            expect(undoHistoryStore.value?.past).toHaveLength(0);
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(samples).toEqual(new Float32Array(SAMPLE_RATE));
        }
    );

    it.each(['Detect', 'sensitivity'] as const)(
        'review repair: removes the last unlocked automatic marker on silence through %s with real UndoRedo',
        async (route) => {
            const samples = new Float32Array(SAMPLE_RATE);
            supplyBuffer(samples);
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
            warpStateStore.set({ states: { 'other-clip': otherWarpState } });
            const defaults = structuredClone(getWarpState(CLIP_ID));
            const original = { ...defaults, markers: [{ ...lockedMarker, locked: false }] };
            setWarpState(CLIP_ID, original);
            flushAutomergeStorageWrites();
            clearUndoHistory();
            if (route === 'Detect') {
                await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID, sensitivity: 0.5 } });
            } else {
                await setElasticSensitivity(0.5);
                expect(elasticAudioStore.value?.detected).toBe(true);
            }
            expect(getWarpState(CLIP_ID)).toEqual(defaults);
            expectCanonicalWarpAbsence();
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect((await undo()).headConsumed).toBe(true);
            expect(rawWarpState()).toEqual(original);
            expect(getWarpState(CLIP_ID)).toEqual(original);
            await redo();
            expect(getWarpState(CLIP_ID)).toEqual(defaults);
            expectCanonicalWarpAbsence();
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(samples).toEqual(new Float32Array(SAMPLE_RATE));
        }
    );

    it.each([
        ['removed', null],
        ['removed', CLIP_ID],
        ['swapped', null],
        ['swapped', CLIP_ID],
    ] as const)('review repair: revokes direct Detect after source %s ABA with editor %s', async (change, editor) => {
        const samples = burstSamples();
        const originalSamples = samples.slice();
        supplyBuffer(samples);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        elasticAudioStore.set({ ...defaultElasticAudioState, openClipId: editor });
        const tracks = trackStore.value;
        if (!tracks) {
            throw new Error('Expected original source tracks');
        }
        const cached = audioBufferCache.get(BUFFER_ID);
        const rootIdentity = captureProjectRootIdentity();
        const preference = preferencesStore.value?.elasticTransientSensitivity;
        const tempo = transportStore.value?.tempo;
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<TransientOnsetWorkerResult>();
        worker.mockImplementationOnce(() => {
            entered.resolve();
            return release.promise;
        });
        clearUndoHistory();
        const original = structuredClone(rawWarpState());
        const execution = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        const rejected = expect(execution).rejects.toThrow(/cancelled|changed|conflict/i);
        await entered.promise;
        trackStore.set({
            ...tracks,
            tracks: tracks.tracks.map((track) => {
                let clips: typeof track.clips;
                if (change === 'removed') {
                    clips = track.clips.filter((clip) => clip.id !== CLIP_ID);
                } else {
                    clips = track.clips.map((clip) =>
                        clip.id === CLIP_ID ? { ...clip, audioBufferId: 'temporary-other-buffer' } : clip
                    );
                }
                return { ...track, clips };
            }),
        });
        flushAutomergeStorageWrites();
        trackStore.set(tracks);
        flushAutomergeStorageWrites();
        const restored = getCrdtDoc('root');
        if (!restored) {
            throw new Error('Expected restored native source');
        }
        const restoredHeads = getHeads(restored);
        expect(trackStore.value).toEqual(tracks);
        expect(audioBufferCache.get(BUFFER_ID)).toBe(cached);
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(preferencesStore.value?.elasticTransientSensitivity).toBe(preference);
        expect(transportStore.value?.tempo).toBe(tempo);
        expect(elasticAudioStore.value?.openClipId).toBe(editor);
        release.resolve({ status: 'complete', hits: [{ sampleOffset: 1024, confidence: 1 }] });
        await rejected;
        expect(getHeads(getCrdtDoc('root')!)).toEqual(restoredHeads);
        expect(rawWarpState()).toEqual(original);
        expect(getWarpState(CLIP_ID)).toEqual(original);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        expect(rawWarpState().markers).toHaveLength(2);
        expect(rawWarpState().markers).toContainEqual(lockedMarker);
        expect(getWarpState(CLIP_ID)).toEqual(rawWarpState());
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
        expect(samples).toEqual(originalSamples);
    });

    it.each(['no-write', 'conflict', 'failure'] as const)(
        'rejects a later real Command %s as unchanged completion from an earlier invocation',
        async (outcome) => {
            supplyBuffer(new Float32Array(SAMPLE_RATE));
            vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
            warpStateStore.set({ states: { 'other-clip': otherWarpState } });
            flushAutomergeStorageWrites();
            clearUndoHistory();
            await setElasticSensitivity(0.5);
            expect(elasticAudioStore.value?.detected).toBe(true);
            const before = toJS(getCrdtDoc('root')!);
            const actualHandler = getArrangementHandlers().detectTransients;
            if (actualHandler.previewExecution !== 'unsupported-external') {
                throw new Error('Expected the real transient handler to reject isolated-project preview');
            }
            const refuse = async (): Promise<{ status: 'no-write' } | { status: 'conflict'; reason: string }> => {
                if (outcome === 'failure') {
                    throw new Error('registered detector refused');
                }
                if (outcome === 'conflict') {
                    return { status: 'conflict', reason: 'registered detector refused' };
                }
                return { status: 'no-write' };
            };
            clearHandlerRegistry();
            registerHandlerMap({
                ...getArrangementHandlers(),
                ...getFinalFeatureHandlers(),
                detectTransients: { ...actualHandler, execute: refuse },
            });
            await expect(setElasticSensitivity(0.9)).resolves.toBeUndefined();
            expect(elasticAudioStore.value?.detected).toBe(false);
            expect(toJS(getCrdtDoc('root')!)).toEqual(before);
            expectCanonicalWarpAbsence();
            expect(undoHistoryStore.value?.past).toHaveLength(0);
            clearHandlerRegistry();
            registerHandlerMap({ ...getArrangementHandlers(), ...getFinalFeatureHandlers() });
            await setElasticSensitivity(0.4);
            expect(elasticAudioStore.value?.detected).toBe(true);
            expectCanonicalWarpAbsence();
            expect(undoHistoryStore.value?.past).toHaveLength(0);
        }
    );

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
            const frames = holdAnimationFrames();
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
                    const root = getCrdtDoc('root');
                    if (!root) {
                        throw new Error('Expected complete root fixture');
                    }
                    createCrdtDoc('root', clone(root));
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
                    await frames.complete(fresh);
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

    it.each(['Worker', 'materialization', 'commit'] as const)(
        'refuses a selected-owner ABA during %s and preserves native rows until a fresh gesture',
        async (phase) => {
            const samples = burstSamples();
            const originalSamples = samples.slice();
            supplyBuffer(samples);
            elasticAudioStore.set(defaultElasticAudioState);
            clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: CLIP_ID });
            setWarpState(CLIP_ID, { ...getWarpState(CLIP_ID), markers: [lockedMarker, selectedUserMarker] });
            flushAutomergeStorageWrites();
            const before = toJS(getCrdtDoc('root')!);
            const history = structuredClone(undoHistoryStore.value);
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const invalidate = (): void => {
                clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: 'other-clip' });
                clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: CLIP_ID });
            };
            if (phase === 'Worker') {
                worker.mockImplementationOnce(async () => {
                    entered.resolve();
                    await release.promise;
                    return { status: 'complete', hits: [{ sampleOffset: 1024, confidence: 1 }] };
                });
            } else if (phase === 'materialization') {
                const canonical = materialization.getMockImplementation();
                if (!canonical) {
                    throw new Error('Expected real native materialization fixture');
                }
                materialization.mockImplementationOnce(async (request, signal) => {
                    const result = await canonical(request, signal);
                    entered.resolve();
                    await release.promise;
                    return result;
                });
            } else {
                const set = warpStateStore.set.bind(warpStateStore);
                vi.spyOn(warpStateStore, 'set').mockImplementationOnce((value) => {
                    set(value);
                    invalidate();
                    entered.resolve();
                });
            }
            const pending = setElasticSensitivity(0.82);
            await entered.promise;
            if (phase !== 'commit') {
                invalidate();
            }
            release.resolve();
            await pending;
            flushAutomergeStorageWrites();
            expect(toJS(getCrdtDoc('root')!)).toEqual(before);
            expect(undoHistoryStore.value).toEqual(history);
            expect(elasticAudioStore.value?.detected).toBe(false);
            expect(rawWarpState().markers).toEqual([lockedMarker, selectedUserMarker]);
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(samples).toEqual(originalSamples);
            const fresh = setElasticSensitivity(0.4);
            await fresh;
            expect(elasticAudioStore.value?.detected).toBe(true);
            expect(rawWarpState().markers.length).toBeGreaterThan(2);
            expect(rawWarpState().markers).toEqual(getWarpState(CLIP_ID).markers);
            expect(rawWarpState().markers).toContainEqual(lockedMarker);
            expect(rawWarpState().markers).toContainEqual(selectedUserMarker);
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(samples).toEqual(originalSamples);
            await undo();
            expect(rawWarpState().markers).toEqual([lockedMarker, selectedUserMarker]);
            await redo();
            expect(rawWarpState().markers.length).toBeGreaterThan(2);
        }
    );

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

    it('completes a genuine native no-change sensitivity through the actual registered commit route', async () => {
        const samples = new Float32Array(SAMPLE_RATE);
        supplyBuffer(samples);
        const root = getCrdtDoc('root');
        if (!root) {
            throw new Error('Expected native root');
        }
        const heads = getHeads(root);
        const before = toJS(root);
        const history = undoHistoryStore.value?.past.length ?? 0;
        await setElasticSensitivity(0.5);
        expect(elasticAudioStore.value?.detected).toBe(true);
        const current = getCrdtDoc('root');
        if (!current) {
            throw new Error('Expected completed native root');
        }
        expect(getHeads(current)).toEqual(heads);
        expect(toJS(current)).toEqual(before);
        expect(undoHistoryStore.value?.past).toHaveLength(history + 1);
        expect(rawWarpState().markers).toEqual([lockedMarker]);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
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
    it('waits for a frame before writing and captures the latest real user and locked rows for Undo and Redo', async () => {
        supplyBuffer(burstSamples());
        const frames = holdAnimationFrames();
        const original = JSON.stringify(getCrdtDoc('root'));
        const originalProjection = structuredClone(getWarpState(CLIP_ID));
        const execution = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        const frame = await frames.next();
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(original);
        expect(getWarpState(CLIP_ID)).toEqual(originalProjection);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        addManualMarker(CLIP_ID, 1.5);
        toggleMarkerLock(CLIP_ID, lockedMarker.id);
        updateWarpMarkerBeat({ clipId: CLIP_ID, markerId: lockedMarker.id, field: 'warpedBeat', beat: 1.3 });
        toggleMarkerLock(CLIP_ID, lockedMarker.id);
        flushAutomergeStorageWrites();
        const before = structuredClone(rawWarpState());
        const latestLocked = before.markers.find((marker) => marker.id === lockedMarker.id);
        expect(latestLocked).toMatchObject({ warpedBeat: 1.3, locked: true });
        frame(performance.now());
        await frames.complete(execution);
        const after = structuredClone(rawWarpState());
        expect(after.markers).toHaveLength(3);
        for (const marker of before.markers) {
            expect(after.markers).toContainEqual(marker);
        }
        expect(getWarpState(CLIP_ID)).toEqual(after);
        await undo();
        expect(rawWarpState()).toEqual(before);
        await redo();
        expect(rawWarpState()).toEqual(after);
        expect(getWarpState(CLIP_ID)).toEqual(after);
    });

    it.each([false, true])(
        'Detect and UndoRedo preserve peer state after an ancestor-author merge in reverse=%s',
        async (reverse) => {
            const samples = burstSamples();
            const originalPcm = samples.slice();
            supplyBuffer(samples);
            const legacyLockedMarker = { ...lockedMarker, id: 'warp-12345678-9abc-4def-8123-456789abcdef' };
            const peerMarker = {
                ...selectedUserMarker,
                id: 'peer opaque existing marker',
                originalBeat: 1.7,
                warpedBeat: 1.9,
            };
            setWarpState(CLIP_ID, { ...getWarpState(CLIP_ID), markers: [legacyLockedMarker, selectedUserMarker] });
            flushAutomergeStorageWrites();
            clearUndoHistory();
            const base = getCrdtDoc<{
                warpStates: { states: Record<string, WarpState> };
                peerLeft?: { retained: string };
                peerRight?: { retained: string };
            }>('root');
            if (!base) {
                throw new Error('Expected real native root');
            }
            const actor = getActorId(base);
            const ownHeads = getHeads(base);
            const left = change(clone(base, { actor: 'bbbbbbbbbbbbbbbb' }), (draft) => {
                draft.peerLeft = { retained: 'left' };
                const state = draft.warpStates.states[CLIP_ID];
                if (!state) {
                    throw new Error('Expected peer marker owner');
                }
                state.markers.push(peerMarker);
            });
            const right = change(clone(base, { actor: 'cccccccccccccccc' }), (draft) => {
                draft.peerRight = { retained: 'right' };
            });
            const merged = merge(clone(reverse ? right : left, { actor }), reverse ? left : right);
            free(left);
            free(right);
            const previousHeads = getHeads(merged);
            expect(previousHeads).toHaveLength(2);
            expect(previousHeads).not.toContain(ownHeads[0]);
            replaceCrdtDocInLineage({ id: 'root', doc: merged });
            warpStateStore.hydrate();
            const before = structuredClone(rawWarpState());
            expect(getWarpState(CLIP_ID)).toEqual(before);
            const retainedIds = before.markers.map((marker) => marker.id);
            const nativeRows = rawWarpState().markers.map((marker) => getObjectId(marker));
            const frames = holdAnimationFrames();
            await frames.complete(executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } }));
            expect(materialization).toHaveBeenCalledTimes(1);
            const actual = getCrdtDoc('root');
            if (!actual) {
                throw new Error('Expected detected native root');
            }
            const additions = getChangesMetaSince(actual, previousHeads);
            expect(additions).toHaveLength(1);
            expect(additions[0]?.actor).toBe(actor);
            const dependencies = additions[0]?.deps ?? [];
            expect([...dependencies].sort()).toEqual([...previousHeads, ...ownHeads].sort());
            const after = structuredClone(rawWarpState());
            expect(after.markers).toHaveLength(4);
            const created = after.markers.filter((marker) => !retainedIds.includes(marker.id));
            expect(created).toHaveLength(1);
            expect(created[0]?.id).toMatch(/^warp-[A-Za-z0-9_-]{22}$/);
            for (const [index, id] of retainedIds.entries()) {
                const retained = rawWarpState().markers.find((marker) => marker.id === id);
                expect(retained).toEqual(before.markers[index]);
                expect(getObjectId(retained!)).toBe(nativeRows[index]);
            }
            expect(actual.peerLeft).toEqual({ retained: 'left' });
            expect(actual.peerRight).toEqual({ retained: 'right' });
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            await undo();
            expect(rawWarpState()).toEqual(before);
            expect(getCrdtDoc('root')?.peerLeft).toEqual({ retained: 'left' });
            expect(getCrdtDoc('root')?.peerRight).toEqual({ retained: 'right' });
            await redo();
            expect(rawWarpState()).toEqual(after);
            expect(getWarpState(CLIP_ID)).toEqual(after);
            expect(getCrdtDoc('root')?.peerLeft).toEqual({ retained: 'left' });
            expect(getCrdtDoc('root')?.peerRight).toEqual({ retained: 'right' });
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(samples).toEqual(originalPcm);

            toggleMarkerLock(CLIP_ID, legacyLockedMarker.id);
            flushAutomergeStorageWrites();
            const beforeUnlockedDetection = structuredClone(rawWarpState());
            expect(beforeUnlockedDetection.markers.find((marker) => marker.id === legacyLockedMarker.id)?.locked).toBe(
                false
            );
            const historyBeforeDetection = undoHistoryStore.value?.past.length ?? 0;
            await frames.complete(executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } }));
            expect(materialization).toHaveBeenCalledTimes(2);
            const afterUnlockedDetection = structuredClone(rawWarpState());
            expect(afterUnlockedDetection.markers).toHaveLength(3);
            expect(afterUnlockedDetection.markers.some((marker) => marker.id === legacyLockedMarker.id)).toBe(false);
            expect(afterUnlockedDetection.markers.some((marker) => marker.id === created[0]?.id)).toBe(false);
            const replacement = afterUnlockedDetection.markers.filter((marker) => marker.origin === 'transient-auto');
            expect(replacement).toHaveLength(1);
            expect(replacement[0]?.id).toMatch(/^warp-[A-Za-z0-9_-]{22}$/);
            for (const marker of [selectedUserMarker, peerMarker]) {
                const retained = rawWarpState().markers.find((candidate) => candidate.id === marker.id);
                expect(retained).toEqual(marker);
                expect(getObjectId(retained!)).toBe(nativeRows[retainedIds.indexOf(marker.id)]);
            }
            expect(undoHistoryStore.value?.past).toHaveLength(historyBeforeDetection + 1);
            await undo();
            expect(rawWarpState()).toEqual(beforeUnlockedDetection);
            await redo();
            expect(rawWarpState()).toEqual(afterUnlockedDetection);
            const current = getCrdtDoc('root');
            if (!current) {
                throw new Error('Expected detected root for checked reload');
            }
            const encodingClone = clone(current);
            let checked: typeof current | undefined;
            try {
                checked = load(save(encodingClone), { actor });
                expect(toJS(checked)).toEqual(toJS(current));
                expect(getHeads(checked)).toEqual(getHeads(current));
            } finally {
                if (checked) {
                    free(checked);
                }
                free(encodingClone);
            }
            expect(current.peerLeft).toEqual({ retained: 'left' });
            expect(current.peerRight).toEqual({ retained: 'right' });
            expect(rawWarpState('other-clip')).toEqual(otherWarpState);
            expect(samples).toEqual(originalPcm);
        }
    );

    it('keeps the materialization await private and captures a fresh inverse after its stale result', async () => {
        supplyBuffer(burstSamples());
        const frames = holdAnimationFrames();
        const complete = materialization.getMockImplementation();
        if (!complete) {
            throw new Error('Expected real native codec transport fixture');
        }
        const entered = Promise.withResolvers<{ request: MaterializationRequest; signal: AbortSignal }>();
        const result = Promise.withResolvers<MaterializationResult>();
        materialization.mockImplementationOnce((request, signal) => {
            entered.resolve({ request, signal });
            return result.promise;
        });
        const before = JSON.stringify(getCrdtDoc('root'));
        const projection = getWarpState(CLIP_ID);
        const pending = storageRuntime.countPendingAutomergeStorageWrites();
        const execution = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        (await frames.next())(performance.now());
        (await frames.next())(performance.now());
        const request = await entered.promise;
        expect(materialization).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(before);
        expect(getWarpState(CLIP_ID)).toBe(projection);
        expect(storageRuntime.countPendingAutomergeStorageWrites()).toBe(pending);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        addManualMarker(CLIP_ID, 1.5);
        flushAutomergeStorageWrites();
        const latest = structuredClone(rawWarpState());
        const priorHistoryLength = undoHistoryStore.value?.past.length ?? 0;
        result.resolve(await complete(request.request, request.signal));
        await frames.complete(execution);
        const after = structuredClone(rawWarpState());
        for (const marker of latest.markers) {
            expect(after.markers).toContainEqual(marker);
        }
        expect(undoHistoryStore.value?.past).toHaveLength(priorHistoryLength + 1);
        await undo();
        expect(rawWarpState()).toEqual(latest);
        await redo();
        expect(rawWarpState()).toEqual(after);
    });

    it.each(['abort', 'root'] as const)(
        'rejects a late materialization result after %s without publication',
        async (kind) => {
            supplyBuffer(burstSamples());
            const frames = holdAnimationFrames();
            const complete = materialization.getMockImplementation();
            if (!complete) {
                throw new Error('Expected native codec fixture');
            }
            const entered = Promise.withResolvers<{ request: MaterializationRequest; signal: AbortSignal }>();
            const result = Promise.withResolvers<MaterializationResult>();
            materialization.mockImplementationOnce((request, signal) => {
                entered.resolve({ request, signal });
                return result.promise;
            });
            const controller = new AbortController();
            const execution = executeAppAction(
                { type: 'detectTransients', payload: { clipId: CLIP_ID } },
                { signal: controller.signal }
            );
            const rejected = expect(execution).rejects.toThrow(/cancelled|changed/);
            (await frames.next())(performance.now());
            (await frames.next())(performance.now());
            const request = await entered.promise;
            expect(materialization).toHaveBeenCalledTimes(1);
            if (kind === 'abort') {
                controller.abort();
            } else {
                createCrdtDoc('root');
            }
            const current = JSON.stringify(getCrdtDoc('root'));
            result.resolve(await complete(request.request, request.signal));
            await rejected;
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(current);
            expect(undoHistoryStore.value?.past).toHaveLength(0);
        }
    );

    it('replans a materialized private candidate from latest retained and unrelated edits before real Undo', async () => {
        supplyBuffer(burstSamples());
        const frames = holdAnimationFrames();
        const execution = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        (await frames.next())(performance.now());
        (await frames.next())(performance.now());
        const admission = await frames.next();
        expect(rawWarpState().markers).toEqual([lockedMarker]);
        await executeAppAction({
            type: 'renameTrack',
            payload: { trackId: 'audio-track', name: 'Latest independent name' },
        });
        addManualMarker(CLIP_ID, 1.5);
        setWarpState('other-clip', { ...getWarpState('other-clip'), originalTempo: 99 });
        flushAutomergeStorageWrites();
        const latest = structuredClone(rawWarpState());
        admission(performance.now());
        await frames.complete(execution);
        const after = structuredClone(rawWarpState());
        for (const marker of latest.markers) {
            expect(after.markers).toContainEqual(marker);
        }
        expect(getWarpState('other-clip').originalTempo).toBe(99);
        expect(trackStore.value?.tracks[0]?.name).toBe('Latest independent name');
        expect(getWarpState(CLIP_ID)).toEqual(after);
        await undo();
        expect(rawWarpState()).toEqual(latest);
        expect(trackStore.value?.tracks[0]?.name).toBe('Latest independent name');
        expect(getWarpState('other-clip').originalTempo).toBe(99);
        await redo();
        expect(rawWarpState()).toEqual(after);
    });

    it.each(['abort', 'editor disposal', 'editor switch', 'preference reset', 'pagehide', 'successor'] as const)(
        'settles a held frame on %s without releasing it or writing',
        async (reason) => {
            supplyBuffer(burstSamples());
            const frames = holdAnimationFrames();
            const controller = new AbortController();
            if (reason === 'editor disposal') {
                render(<ElasticEditorPanel />);
            }
            if (reason === 'preference reset') {
                preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
            }
            const before = JSON.stringify(getCrdtDoc('root'));
            const execution = executeAppAction(
                { type: 'detectTransients', payload: { clipId: CLIP_ID } },
                { signal: controller.signal }
            );
            const rejected = expect(execution).rejects.toThrow(/cancelled|changed/);
            const staleFrame = await frames.next();
            let successor: Promise<void> | undefined;
            if (reason === 'abort') {
                controller.abort();
            }
            if (reason === 'editor disposal') {
                cleanup();
            }
            if (reason === 'editor switch') {
                openElasticEditor('other-clip');
            }
            if (reason === 'preference reset') {
                resetPreferences();
            }
            if (reason === 'pagehide') {
                window.dispatchEvent(new Event('pagehide'));
            }
            if (reason === 'successor') {
                successor = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
            }
            await rejected;
            expect(frames.cancelled).toHaveBeenCalled();
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(before);
            expect(undoHistoryStore.value?.past).toHaveLength(0);
            staleFrame(performance.now());
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(before);
            if (successor) {
                await frames.complete(successor);
                expect(rawWarpState().markers).toHaveLength(2);
            }
        }
    );

    it.each(['before wait', 'during wait'] as const)(
        'completes a valid hidden-page detection %s without a frame',
        async (timing) => {
            supplyBuffer(burstSamples());
            const frames = holdAnimationFrames();
            const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(timing === 'before wait');
            const execution = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
            let staleFrame: FrameRequestCallback | undefined;
            if (timing === 'during wait') {
                staleFrame = await frames.next();
                hidden.mockReturnValue(true);
                document.dispatchEvent(new Event('visibilitychange'));
            }
            await execution;
            expect(rawWarpState().markers).toHaveLength(2);
            expect(getWarpState(CLIP_ID)).toEqual(rawWarpState());
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            const committed = JSON.stringify(getCrdtDoc('root'));
            staleFrame?.(performance.now());
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(committed);
        }
    );

    it.each(['tempo', 'buffer', 'clip', 'root'] as const)(
        'refuses a held frame after its %s source changes',
        async (source) => {
            supplyBuffer(burstSamples());
            const frames = holdAnimationFrames();
            const execution = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
            const rejected = expect(execution).rejects.toThrow(/cancelled|changed/);
            const frame = await frames.next();
            if (source === 'tempo') {
                transportStore.set({ ...defaultTransportState, tempo: 128 });
            }
            if (source === 'buffer' || source === 'clip') {
                trackStore.update((state) => {
                    if (!state) {
                        return state;
                    }
                    return {
                        ...state,
                        tracks: state.tracks.map((track) => {
                            let clips = track.clips;
                            if (source === 'clip') {
                                clips = clips.filter((clip) => clip.id !== CLIP_ID);
                            } else {
                                clips = clips.map((clip) =>
                                    clip.id === CLIP_ID ? { ...clip, audioBufferId: 'replacement' } : clip
                                );
                            }
                            return { ...track, clips };
                        }),
                    };
                });
            }
            if (source === 'root') {
                createCrdtDoc('root');
            }
            flushAutomergeStorageWrites();
            const changed = JSON.stringify(getCrdtDoc('root'));
            frame(performance.now());
            await rejected;
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(changed);
            expect(undoHistoryStore.value?.past).toHaveLength(0);
        }
    );

    it('requires the configured root reader on the registered route and permits retry', async () => {
        supplyBuffer(burstSamples());
        setElasticRootIdentityProvider(null);
        setElasticSensitivityRootIdentityCapture(null);
        clipSelectionStore.set(defaultClipSelectionState);
        const calls = worker.mock.calls.length;
        const before = toJS(getCrdtDoc('root')!);
        await expect(executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } })).rejects.toThrow(
            /cancelled|changed/
        );
        expect(worker).toHaveBeenCalledTimes(calls);
        expect(getCrdtDoc('root')).toEqual(before);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        setElasticRootIdentityProvider(captureProjectRootIdentity);
        setElasticSensitivityRootIdentityCapture(captureProjectRootIdentity);
        clipSelectionStore.set(defaultClipSelectionState);
        await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        expect(rawWarpState().markers.length).toBeGreaterThan(1);
    });
    it.each(['removed', 'replaced', 'root-ABA'] as const)(
        'refuses a held registered result after %s even when the root values match',
        async (change) => {
            supplyBuffer(burstSamples());
            const frames = holdAnimationFrames();
            const original = getCrdtDoc('root');
            if (!original) {
                throw new Error('Expected live root');
            }
            const before = toJS(original);
            const epoch = captureProjectRootIdentity();
            const execution = executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
            const rejected = expect(execution).rejects.toThrow(/cancelled|changed/);
            const frame = await frames.next();
            if (change === 'removed') {
                setElasticRootIdentityProvider(null);
                setElasticSensitivityRootIdentityCapture(null);
                clipSelectionStore.set(defaultClipSelectionState);
            } else if (change === 'replaced') {
                setElasticRootIdentityProvider(() => captureProjectRootIdentity());
                expect(captureProjectRootIdentity()).toBe(epoch);
            } else {
                createCrdtDoc('root');
                replaceCrdtDocInLineage({ id: 'root', doc: clone(original) });
                expect(captureProjectRootIdentity()).not.toBe(epoch);
            }
            expect(getCrdtDoc('root')).toEqual(before);
            frame(performance.now());
            await rejected;
            expect(getCrdtDoc('root')).toEqual(before);
            expect(undoHistoryStore.value?.past).toHaveLength(0);
        }
    );

    it('undoes the first detection from absent warp state and guards the absent-state redo', async () => {
        supplyBuffer(burstSamples());
        warpStateStore.set({ states: { 'other-clip': otherWarpState } });
        flushAutomergeStorageWrites();
        const original = getCrdtDoc('root');
        if (!original) {
            throw new Error('Expected live root');
        }
        const before = toJS(original);
        await executeAppAction({ type: 'detectTransients', payload: { clipId: CLIP_ID } });
        const after = structuredClone(rawWarpState());
        expect(after.markers).toHaveLength(1);
        expect((await undo()).headConsumed).toBe(true);
        expect(getCrdtDoc('root')).toEqual(before);
        expect(getWarpState(CLIP_ID).markers).toEqual([]);
        await redo();
        expect(rawWarpState()).toEqual(after);
        expect(getWarpState(CLIP_ID)).toEqual(after);
        await undo();
        addManualMarker(CLIP_ID, 1.5);
        flushAutomergeStorageWrites();
        const diverged = JSON.stringify(getCrdtDoc('root'));
        const history = JSON.stringify(undoHistoryStore.value);
        await redo();
        expect(JSON.stringify(undoHistoryStore.value)).toBe(history);
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(diverged);
        expect(rawWarpState('other-clip')).toEqual(otherWarpState);
    });

    it('captures the inverse after the Worker and keeps concurrent edits through real Undo and Redo', async () => {
        supplyBuffer(burstSamples());
        let finish: ((result: TransientOnsetWorkerResult) => void) | undefined;
        const started = new Promise<void>((resolve) =>
            worker.mockImplementationOnce(() => {
                resolve();
                return new Promise((resolve) => {
                    finish = resolve;
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
                return new Promise((resolve) => {
                    finish = resolve;
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
                return new Promise((resolve) => {
                    finish = resolve;
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
                return new Promise((resolve) => {
                    finish = resolve;
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
            if (!port?.mutateDocValidated) {
                throw new Error('Production runtime must provide prospective validation');
            }
            const mutateValidated = port.mutateDocValidated;
            configureAutomergeStoragePort({
                ...port,
                mutateDocValidated: (input) =>
                    mutateValidated({
                        ...input,
                        validateDocument: (candidate) => {
                            input.validateDocument(candidate);
                            if (mode === 'reject') {
                                throw new Error('materialized candidate refused');
                            }
                            const current = getCrdtDoc<{ tracks: { tracks: ReturnType<typeof createTrack>[] } }>(
                                'root'
                            );
                            if (!current) {
                                throw new Error('Expected live project');
                            }
                            replaceCrdtDocInLineage({
                                id: 'root',
                                doc: change(clone(current), (draft) => {
                                    const track = draft.tracks.tracks[0];
                                    if (!track) {
                                        throw new Error('Expected audio track');
                                    }
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
        for (const marker of retained) {
            expect(rawWarpState().markers).toContainEqual(marker);
        }
        expect(rawWarpState().markers).toEqual(getWarpState(CLIP_ID).markers);
    });
});
