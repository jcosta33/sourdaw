import { Buffer } from 'node:buffer';

import { clone, getHeads } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { cacheAudioBuffer, getCachedAudioBuffer, getCompensationDelay } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
    redo,
} from '#/modules/Command/useCases';
import { actionHistoryStore, getSemanticContext } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    recordActionHistoryEntry,
    markActionHistoryEntryReverted,
    clearActionHistory,
    mutateCrdtDoc,
    replaceCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { captureClipPitchAnalysis, restoreClipPitchAnalysis } from '#/modules/Knead/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    defaultProjectStoreState,
    projectStore,
    arrangementStore,
    defaultArrangementId,
} from '#/modules/Project/stores';
import { defaultTransportState, transportStore, tempoMapStore } from '#/modules/Transport/stores';
import { setNotificationEventBus, type NotifyPayload } from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { handleBounceSelection } from '../../../handlers/clip/handleBounceSelection';
import { handleConsolidateSelection } from '../../../handlers/clip/handleConsolidateSelection';
import { type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { setArrangementEventBus } from '../../arrangementEventBus';
import { createTrack } from '../../createTrack';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { renderTrackOffline } from '../renderOffline';

const cache = vi.hoisted(() =>
    vi.fn((input: { buffer: AudioBuffer; bufferId?: string }) => input.bufferId ?? 'rendered-buffer')
);
vi.mock('#/modules/AudioEngine/useCases', async (original) => {
    const actual = await original<typeof import('#/modules/AudioEngine/useCases')>();
    cache.mockImplementation(actual.cacheAudioBuffer);
    return { ...actual, cacheAudioBuffer: cache };
});
vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));

registerSupportingServicePorts();
const notifications: NotifyPayload[] = [];
let publicationFault: 'none' | 'before' | 'after' | 'late-source' = 'none';
let publicationFaultCalls = 0;
let offlineAllocations = 0;

type RawRoot = { tracks?: { tracks: Track[] } };
function updateFixtureTrack(tracks: Track[], id: string, update: (track: Track) => Track): Track[] {
    return tracks.map((track) => {
        if (track.id === id) {
            return update(track);
        }
        return track;
    });
}
function rawTracks() {
    return structuredClone(getCrdtDoc<RawRoot>('root')?.tracks?.tracks ?? []);
}
function expectPcmEqual(actual: Float32Array, expected: Float32Array): void {
    expect(
        Buffer.compare(
            Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength),
            Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength)
        )
    ).toBe(0);
}
function pcmBuffer(length = 48000, sampleRate = 48000, filled = true): AudioBuffer {
    const data = new Float32Array(length);
    if (filled) {
        for (let frame = 0; frame < length; frame++) {
            data[frame] = frame / length;
        }
    }
    return {
        duration: length / sampleRate,
        sampleRate,
        length: data.length,
        numberOfChannels: 1,
        getChannelData: () => data,
        copyFromChannel: (target, _channel, offset = 0) => target.set(data.subarray(offset, offset + target.length)),
        copyToChannel: (source, _channel, offset = 0) => data.set(source, offset),
    };
}
function gateRender() {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<AudioBuffer | null>();
    vi.mocked(renderTrackOffline).mockImplementationOnce(() => {
        entered.resolve();
        return release.promise;
    });
    return { entered: entered.promise, release: release.resolve };
}

beforeEach(() => {
    vi.clearAllMocks();
    publicationFault = 'none';
    publicationFaultCalls = 0;
    offlineAllocations = 0;
    vi.stubGlobal(
        'OfflineAudioContext',
        class {
            constructor() {
                offlineAllocations++;
            }
            createBuffer(_channels: number, length: number, rate: number) {
                return pcmBuffer(length, rate, false);
            }
        }
    );
    notifications.length = 0;
    setNotificationEventBus({
        emit: async (event, payload) => {
            if (event === 'ui.notify' && 'message' in payload && 'level' in payload) {
                notifications.push(payload);
            }
        },
        on: () => () => undefined,
    });
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('source render admission test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    configureAutomergeStoragePort({
        getDoc: (id) => getCrdtDoc(id),
        getDocHeads: (id) => {
            const doc = getCrdtDoc(id);
            return doc ? getHeads(doc) : undefined;
        },
        hasDoc: (id) => getCrdtDoc(id) !== undefined,
        getSemanticMessage: () => getSemanticContext()?.message,
        mutateDoc: ({ docId, changeFn, beforeChange, changedKeys, message, snapshotTransaction }) => {
            if (publicationFault !== 'none') {
                publicationFaultCalls++;
                if (publicationFault === 'before') {
                    throw new Error('Controlled before-publication failure');
                }
                if (publicationFault === 'late-source') {
                    publicationFault = 'none';
                    mutateCrdtDoc<RawRoot>({
                        id: 'root',
                        changeFn: (document) => {
                            const clip = document.tracks?.tracks[0]?.clips[0];
                            if (clip) {
                                clip.audioOffsetSeconds = 4;
                            }
                        },
                    });
                }
            }
            mutateCrdtDoc({ id: docId, changeFn, beforeChange, localSlots: changedKeys, message, snapshotTransaction });
            if (publicationFault === 'after') {
                throw new Error('Controlled after-publication failure');
            }
        },
    });
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    clearUndoHistory();
    resetActionReplayAuthority();
    setActionHistoryMetadataPort({
        record: recordActionHistoryEntry,
        markReverted: markActionHistoryEntryReverted,
        clear: clearActionHistory,
    });
    projectStore.set(structuredClone(defaultProjectStoreState));
    arrangementStore.set({
        activeArrangementId: defaultArrangementId,
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    transportStore.set({ ...defaultTransportState, tempo: 60 });
    tempoMapStore.set({ changes: [] });
    automationStore.set({ lanes: [] });
    trackStore.set({
        tracks: [
            {
                ...createTrack({ id: 'track-1', name: 'Source', kind: 'audio' }),
                clips: [ClipDummy.create({ id: 'source', startBeat: 2, endBeat: 6, audioOffsetSeconds: 1 })],
            },
            createTrack({ id: 'peer', name: 'Peer', kind: 'audio' }),
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
    cacheAudioBuffer({ bufferId: 'buffer-1', buffer: pcmBuffer(384000) });
    cache.mockClear();
});
afterEach(() => {
    publicationFault = 'none';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    flushAutomergeStorageWrites();
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    setActionHistoryMetadataPort({
        record: () => [],
        markReverted: () => ({ status: 'unavailable' }),
        clear: () => undefined,
    });
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('selection render admission through typed commands', () => {
    it.each(['bounceSelection', 'consolidateSelection'] as const)(
        'keeps a newer same-id source slip instead of publishing a stale %s',
        async (type) => {
            expect(handleBounceSelection.executionKind).toBeUndefined();
            expect(handleConsolidateSelection.executionKind).toBeUndefined();
            const gate = gateRender();
            const pending = executeAppAction({ type, payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 } });
            await gate.entered;
            await executeAppAction({
                type: 'slipClipContent',
                payload: { clipId: 'source', clipType: 'audio', offset: 3 },
            });
            flushAutomergeStorageWrites();
            const slipped = rawTracks();
            expect(slipped[0]?.clips[0]?.audioOffsetSeconds).toBe(3);
            const historyBefore = structuredClone(actionHistoryStore.value?.entries ?? []);
            const undoBefore = undoStore.value?.past.length;
            const rendered = pcmBuffer();
            const pcmBefore = rendered.getChannelData(0).slice();
            gate.release(rendered);
            await pending;
            flushAutomergeStorageWrites();

            expect(notifications).toEqual([
                { message: 'Bounce cancelled because its source changed during rendering.', level: 'warning' },
            ]);
            expect({
                tracks: rawTracks(),
                projection: trackStore.value?.tracks,
                history: actionHistoryStore.value?.entries,
                undoCount: undoStore.value?.past.length,
                cacheCalls: cache.mock.calls.length,
                pcm: rendered.getChannelData(0),
            }).toEqual({
                tracks: slipped,
                projection: slipped,
                history: historyBefore,
                undoCount: undoBefore,
                cacheCalls: 0,
                pcm: pcmBefore,
            });
        }
    );

    it('commits unchanged source once and replays its actual callback history over the raw document', async () => {
        const gate = gateRender();
        const pending = executeAppAction({
            type: 'bounceSelection',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
        });
        await gate.entered;
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'peer', name: 'Peer edit' } });
        await executeAppAction({ type: 'selectTrack', payload: { trackId: 'peer' } });
        flushAutomergeStorageWrites();
        const before = rawTracks();
        gate.release(pcmBuffer());
        await pending;
        flushAutomergeStorageWrites();
        const after = rawTracks();
        expect(after[0]?.clips[0]?.audioBufferId).toBe(cache.mock.calls[0]?.[0].bufferId);
        expect(after[1]?.name).toBe('Peer edit');
        expect(trackStore.value?.selectedTrackId).toBe('peer');
        expect(trackStore.value?.tracks).toEqual(after);
        expect(undoStore.value?.past).toHaveLength(2);
        await undo();
        flushAutomergeStorageWrites();
        expect(rawTracks()).toEqual(before);
        await redo();
        flushAutomergeStorageWrites();
        expect(rawTracks()).toEqual(after);
    });
    it.each([
        'source-aba',
        'tempo-aba',
        'root-replacement',
        'project-identity',
        'cancel',
        'arrangement',
        'mixer',
        'buffer',
    ] as const)('refuses held sampled work after %s', async (change) => {
        const gate = gateRender();
        const controller = new AbortController();
        const pending = executeAppAction(
            { type: 'bounceSelection', payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 } },
            { signal: controller.signal }
        );
        await gate.entered;
        if (change === 'source-aba') {
            await executeAppAction({
                type: 'slipClipContent',
                payload: { clipId: 'source', clipType: 'audio', offset: 3 },
            });
            await executeAppAction({
                type: 'slipClipContent',
                payload: { clipId: 'source', clipType: 'audio', offset: 1 },
            });
        } else if (change === 'tempo-aba') {
            transportStore.set({ ...transportStore.value!, tempo: 75 });
            flushAutomergeStorageWrites();
            transportStore.set({ ...transportStore.value!, tempo: 60 });
            flushAutomergeStorageWrites();
        } else if (change === 'root-replacement') {
            const doc = getCrdtDoc('root');
            if (!doc) {
                throw new Error('Expected root');
            }
            replaceCrdtDoc({ id: 'root', doc: clone(doc) });
        } else if (change === 'project-identity') {
            projectStore.set({ ...projectStore.value!, createdAt: projectStore.value!.createdAt + 1 });
            flushAutomergeStorageWrites();
        } else if (change === 'cancel') {
            controller.abort();
        } else if (change === 'arrangement') {
            arrangementStore.set({
                activeArrangementId: 'replacement-arrangement',
                arrangements: [
                    ...arrangementStore.value!.arrangements,
                    { ...arrangementStore.value!.arrangements[0]!, id: 'replacement-arrangement' },
                ],
            });
            flushAutomergeStorageWrites();
        } else if (change === 'mixer') {
            await executeAppAction({
                type: 'setTrackGain',
                payload: { trackId: 'track-1', expectedGain: 0.8, gain: 0.4 },
            });
        } else {
            cacheAudioBuffer({ bufferId: 'buffer-1', buffer: pcmBuffer(384000) });
            cache.mockClear();
        }
        const expected = rawTracks();
        const undoCount = undoStore.value?.past.length;
        gate.release(pcmBuffer());
        await pending;
        flushAutomergeStorageWrites();
        expect(rawTracks()).toEqual(expected);
        expect(undoStore.value?.past).toHaveLength(undoCount!);
        expect(cache).not.toHaveBeenCalled();
        expect(
            notifications.some(
                (notice) => notice.message === 'Bounce cancelled because its source changed during rendering.'
            )
        ).toBe(true);
    });

    it('admits an ordinary save timestamp during the held render', async () => {
        const gate = gateRender();
        const pending = executeAppAction({
            type: 'bounceSelection',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
        });
        await gate.entered;
        projectStore.set({ ...projectStore.value!, updatedAt: projectStore.value!.updatedAt + 1000 });
        flushAutomergeStorageWrites();
        gate.release(pcmBuffer());
        await pending;
        expect(cache).toHaveBeenCalledTimes(1);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it.each(['before', 'late-source'] as const)(
        'publishes neither cache nor callback history after %s refusal',
        async (fault) => {
            const before = rawTracks();
            const gate = gateRender();
            const pending = executeAppAction({
                type: 'bounceSelection',
                payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
            });
            await gate.entered;
            publicationFault = fault;
            gate.release(pcmBuffer());
            await expect(pending).rejects.toThrow();
            expect(publicationFaultCalls).toBe(1);
            expect(cache).not.toHaveBeenCalled();
            expect(undoStore.value?.past).toHaveLength(0);
            const expected = structuredClone(before);
            if (fault === 'late-source') {
                expected[0]!.clips[0]!.audioOffsetSeconds = 4;
            }
            expect(rawTracks()).toEqual(expected);
            expect(trackStore.value?.tracks).toEqual(expected);
        }
    );

    it('pairs a genuinely published ambiguous result with its exact cache and callback inverse', async () => {
        const before = rawTracks();
        const gate = gateRender();
        const pending = executeAppAction({
            type: 'bounceSelection',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
        });
        await gate.entered;
        publicationFault = 'after';
        const rendered = pcmBuffer();
        gate.release(rendered);
        await expect(pending).rejects.toThrow();
        publicationFault = 'none';
        expect(publicationFaultCalls).toBe(1);
        expect(cache).toHaveBeenCalledTimes(1);
        const after = rawTracks();
        const bufferId = after[0]?.clips[0]?.audioBufferId;
        expect(bufferId).toBeDefined();
        expect(getCachedAudioBuffer({ bufferId: bufferId! })).toBe(rendered);
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        flushAutomergeStorageWrites();
        expect(rawTracks()).toEqual(before);
        await redo();
        flushAutomergeStorageWrites();
        expect(rawTracks()).toEqual(after);
    });

    it('warns through the public Reverse route without publishing or clearing analysis for a wrapped loop', async () => {
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: updateFixtureTrack(state.tracks, 'track-1', (track) => ({
                ...track,
                clips: [
                    ClipDummy.create({
                        id: 'source',
                        startBeat: 0,
                        endBeat: 5,
                        audioOffsetSeconds: 0,
                        loopEnabled: true,
                        loopLength: 4,
                        loopOriginBeat: 0,
                    }),
                ],
            })),
        });
        restoreClipPitchAnalysis('source', {
            contour: {
                points: [{ time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true }],
                sample_rate: 48000,
                hop_size: 256,
            },
        });
        flushAutomergeStorageWrites();
        const before = rawTracks();
        const analysis = captureClipPitchAnalysis('source');
        await executeAppAction({ type: 'reverseClip', payload: { clipId: 'source' } });
        flushAutomergeStorageWrites();
        expect(notifications).toEqual([
            { message: 'Bounce this looped clip to audio before reversing.', level: 'warning' },
        ]);
        expect(rawTracks()).toEqual(before);
        expect(captureClipPitchAnalysis('source')).toEqual(analysis);
        expect(offlineAllocations).toBe(0);
        expect(cache).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it.each([
        { canonical: false, alias: undefined },
        { canonical: false, alias: 0 },
        { canonical: false, alias: 1 },
        { canonical: true, alias: undefined },
        { canonical: true, alias: 0 },
        { canonical: true, alias: 1 },
    ])(
        'reverses and replays a lawful complete period with canonical=$canonical alias=$alias',
        async ({ canonical, alias }) => {
            const state = trackStore.value!;
            const clip = ClipDummy.create({
                id: 'source',
                startBeat: 0,
                endBeat: 4,
                audioOffsetBeats: alias,
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 0,
                fadeInBeats: 0.25,
                fadeOutBeats: 0.5,
            });
            if (alias === undefined) {
                delete clip.audioOffsetBeats;
            }
            if (canonical) {
                clip.audioOffsetSeconds = 1;
                clip.audioUnwrappedOffsetSeconds = 1;
                clip.audioLoopStartSeconds = 1;
                clip.audioLoopPassEntrySeconds = 1;
                clip.audioLoopPassOriginBeat = 0;
            }
            trackStore.set({
                ...state,
                tracks: updateFixtureTrack(state.tracks, 'track-1', (track) => ({ ...track, clips: [clip] })),
            });
            flushAutomergeStorageWrites();
            const before = rawTracks();
            const original = getCachedAudioBuffer({ bufferId: 'buffer-1' })!;
            const originalPcm = original.getChannelData(0).slice();
            await executeAppAction({
                type: 'reverseClip',
                payload: { clipId: 'source', reversedBufferId: 'lawful-reversed' },
            });
            const after = rawTracks();
            expect(after[0]?.clips[0]).toMatchObject({
                audioBufferId: 'lawful-reversed',
                fadeInBeats: 0.5,
                fadeOutBeats: 0.25,
            });
            if (canonical) {
                expect(after[0]?.clips[0]).toMatchObject({
                    audioOffsetSeconds: 3,
                    audioUnwrappedOffsetSeconds: 3,
                    audioLoopStartSeconds: 3,
                    audioLoopPassEntrySeconds: 3,
                    audioLoopPassOriginBeat: 0,
                });
            }
            const reversed = getCachedAudioBuffer({ bufferId: 'lawful-reversed' })!.getChannelData(0);
            const sourceEntry = canonical ? 1 : (alias ?? 0);
            const mirroredEntryFrame = (8 - sourceEntry - 4) * 48000;
            const originalLastFrame = (sourceEntry + 4) * 48000 - 1;
            for (let frame = 0; frame < 192000; frame++) {
                if (reversed[mirroredEntryFrame + frame] !== originalPcm[originalLastFrame - frame]) {
                    throw new Error(`Reverse PCM differs at frame ${frame}`);
                }
            }
            expectPcmEqual(original.getChannelData(0), originalPcm);
            for (let cycle = 0; cycle < 2; cycle++) {
                await undo();
                flushAutomergeStorageWrites();
                expect(rawTracks()).toEqual(before);
                await redo();
                flushAutomergeStorageWrites();
                expect(rawTracks()).toEqual(after);
            }
            expect(trackStore.value?.tracks).toEqual(after);
        }
    );

    it('settles already-visible owner edits before sampling rather than refusing their later flush', async () => {
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: updateFixtureTrack(state.tracks, 'track-1', (track) => ({
                ...track,
                clips: track.clips.map((clip) => ({ ...clip, audioOffsetSeconds: 2 })),
            })),
        });
        const gate = gateRender();
        const pending = executeAppAction({
            type: 'bounceSelection',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
        });
        await gate.entered;
        expect(rawTracks()[0]?.clips[0]?.audioOffsetSeconds).toBe(2);
        gate.release(pcmBuffer());
        await pending;
        expect(cache).toHaveBeenCalledTimes(1);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(notifications).toHaveLength(0);
    });

    it('refuses when a formerly unrelated peer joins the sampled routing graph', async () => {
        const gate = gateRender();
        const pending = executeAppAction({
            type: 'bounceSelection',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
        });
        await gate.entered;
        await executeAppAction({
            type: 'setTrackOutput',
            payload: { trackId: 'peer', outputId: 'track-1', expectedOutputId: 'master' },
        });
        flushAutomergeStorageWrites();
        const expected = rawTracks();
        gate.release(pcmBuffer());
        await pending;
        expect(rawTracks()).toEqual(expected);
        expect(cache).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('authenticates Toaster child note sources even when their output route is outside the render subgraph', async () => {
        const state = trackStore.value!;
        const child = {
            ...createTrack({
                id: 'child',
                name: 'Pad source',
                kind: 'midi',
                parentId: 'track-1',
                withoutDefaultDevice: true,
            }),
            clips: [ClipDummy.create({ id: 'child-clip', trackId: 'child', type: 'midi' })],
        };
        trackStore.set({
            ...state,
            tracks: [
                ...updateFixtureTrack(state.tracks, 'track-1', (track) => ({
                    ...track,
                    devices: [
                        { id: 'toaster', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
                    ],
                })),
                child,
            ],
        });
        const note = { id: 'note', pitch: 60, startBeat: 0, duration: 2, velocity: 100 };
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { 'child-clip': [note] },
            ccByClipId: {},
            pitchBendByClipId: {},
            noteCoordinateFormat: 'clip-relative',
        });
        flushAutomergeStorageWrites();
        expect(rawTracks().find((track) => track.id === 'child')?.outputId).toBe('master');
        const gate = gateRender();
        const pending = executeAppAction({
            type: 'bounceSelection',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
        });
        await gate.entered;
        midiStore.set({ ...midiStore.value!, notesByClipId: { 'child-clip': [{ ...note, pitch: 65 }] } });
        flushAutomergeStorageWrites();
        const expected = rawTracks();
        gate.release(pcmBuffer());
        await pending;
        expect(rawTracks()).toEqual(expected);
        expect(midiStore.value?.notesByClipId['child-clip']?.[0]?.pitch).toBe(65);
        expect(cache).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('authenticates global compensation when an unrelated peer gains a latency-producing device', async () => {
        const previousDelay = getCompensationDelay('track-1');
        const gate = gateRender();
        const pending = executeAppAction({
            type: 'bounceSelection',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
        });
        await gate.entered;
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: updateFixtureTrack(state.tracks, 'peer', (track) => ({
                ...track,
                devices: [
                    {
                        id: 'latency',
                        name: 'Detector',
                        type: 'builtin-sidechain-compressor',
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
            })),
        });
        flushAutomergeStorageWrites();
        expect(getCompensationDelay('track-1')).toBeGreaterThan(previousDelay);
        const expected = rawTracks();
        gate.release(pcmBuffer());
        await pending;
        expect(rawTracks()).toEqual(expected);
        expect(cache).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('refuses a changed baked automation lane during the render', async () => {
        const gate = gateRender();
        const pending = executeAppAction({
            type: 'bounceSelection',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 },
        });
        await gate.entered;
        const lane = createAutomationLane('track-1', 'volume', 'Volume');
        lane.points = [{ beat: 2, value: 0.3, curve: 'linear', tension: 0 }];
        automationStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();
        expect(automationStore.value?.lanes[0]?.points[0]?.value).toBe(0.3);
        gate.release(pcmBuffer());
        await pending;
        expect(automationStore.value?.lanes[0]).toEqual(lane);
        expect(rawTracks()[0]?.clips[0]?.id).toBe('source');
        expect(cache).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(0);
    });
    it('keeps two successful same-millisecond bounces as distinct history material', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1794000000000);
        const firstPcm = pcmBuffer();
        const secondPcm = pcmBuffer();
        secondPcm.getChannelData(0).fill(0.75);
        vi.mocked(renderTrackOffline).mockResolvedValueOnce(firstPcm).mockResolvedValueOnce(secondPcm);
        const action = { type: 'bounceSelection' as const, payload: { trackId: 'track-1', startBeat: 2, endBeat: 6 } };
        await executeAppAction(action);
        const firstId = rawTracks()[0]!.clips[0]!.audioBufferId!;
        await executeAppAction(action);
        const secondId = rawTracks()[0]!.clips[0]!.audioBufferId!;
        await undo();
        flushAutomergeStorageWrites();
        const restored = getCachedAudioBuffer({ bufferId: rawTracks()[0]!.clips[0]!.audioBufferId! })!;
        expect({
            distinct: firstId !== secondId,
            restoredPcm: [0, 10, 47999].map((frame) => restored.getChannelData(0)[frame]),
        }).toEqual({ distinct: true, restoredPcm: [0, 10, 47999].map((frame) => firstPcm.getChannelData(0)[frame]) });
        await redo();
        flushAutomergeStorageWrites();
        expectPcmEqual(getCachedAudioBuffer({ bufferId: secondId })!.getChannelData(0), secondPcm.getChannelData(0));
    });
});
