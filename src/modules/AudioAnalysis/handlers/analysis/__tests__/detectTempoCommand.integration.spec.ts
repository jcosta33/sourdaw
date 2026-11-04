import 'fake-indexeddb/auto';

import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createEventBus } from '#/infra/events/createEventBus';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { type Clip, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, normalizeTrack, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { cacheAudioBuffer, clearRuntimeCachedAudioBuffers } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import {
    defaultTransportState,
    readSecondsAtBeat,
    readTempoAtBeat,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { getAnalysisHandlers } from '../../../useCases/getAnalysisHandlers';

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notify }));

const BASE_BPM = 80;
const MIDI_PHASE_BEATS = 0.5;
const INFERRED_BPM = BASE_BPM / MIDI_PHASE_BEATS;

function clip(id: string, trackId: string, type: Clip['type'], startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId,
        type,
        startBeat,
        endBeat,
        name: id,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        fadeInBeats: 0,
        fadeOutBeats: 0,
    };
}

function installProject(confident = true): void {
    const midiClips: Clip[] = [];
    if (confident) {
        midiClips.push(
            clip('midi-first', 'midi', 'midi', 0, 8),
            clip('midi-second', 'midi', 'midi', MIDI_PHASE_BEATS, 8 + MIDI_PHASE_BEATS)
        );
    } else {
        midiClips.push(clip('midi-first', 'midi', 'midi', 0, 0.5));
    }
    trackStore.set({
        tracks: [
            normalizeTrack({
                id: 'midi',
                name: 'Overlapping beat grids',
                kind: 'midi',
                clips: midiClips,
            }),
            normalizeTrack({
                id: 'audio',
                name: 'Slipped phrase',
                kind: 'audio',
                clips: [{ ...clip('source', 'audio', 'audio', 0, 12), audioBufferId: 'bursts', audioOffsetBeats: 8 }],
            }),
        ],
        selectedTrackId: 'audio',
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

function sourceEntry(): number {
    const track = trackStore.value!.tracks.find((candidate) => candidate.id === 'audio');
    if (!track) {
        throw new Error('Expected the imported phrase track');
    }
    const source = resolveClipsWithComping(track.id, track.clips).find((candidate) => candidate.id === 'source');
    if (!source) {
        throw new Error('Expected the actual resolved source');
    }
    const segment = projectAudioLoopPassSegments({
        clip: source,
        loopLengthBeats: source.endBeat - source.startBeat,
        iterationStartBeat: source.startBeat,
        iterationEndBeat: source.endBeat,
        stretchRatio: 1,
        tempoAtClipStart: readTempoAtBeat({ beat: source.startBeat }),
        secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
    })[0];
    if (!segment) {
        throw new Error('Expected a production source interval');
    }
    return segment.sourceStartSeconds;
}

function authority(): void {
    flushAutomergeStorageWrites();
    const document = getCrdtDoc('root');
    if (!document) {
        throw new Error('Expected the authoritative project');
    }
    const project = Automerge.toJS(document);
    // The owning track adapter writes `{ tracks }` through createAutomergeStorage's JSON-safe projection.
    expect(project.tracks).toEqual({ tracks: trackStore.value!.tracks });
    expect(project).toMatchObject({
        transport: { tempo: transportStore.value!.tempo },
        tempoMap: tempoMapStore.value,
    });
}

function pcmBuffer(): AudioBuffer {
    const sampleRate = 10_000;
    const data = new Float32Array(sampleRate * 3);
    for (let onset = sampleRate / 10; onset < data.length; onset += sampleRate / 2) {
        data.fill(1, onset, onset + sampleRate / 100);
    }
    return {
        sampleRate,
        length: data.length,
        duration: data.length / sampleRate,
        numberOfChannels: 1,
        getChannelData: () => data,
        copyFromChannel: (destination, _channel, start = 0) => {
            destination.set(data.subarray(start, start + destination.length));
        },
        copyToChannel: (source, _channel, start = 0) => {
            data.set(source, start);
        },
    };
}

describe('registered Detect Tempo is analysis only', () => {
    let disposeProjection: (() => void) | undefined;
    beforeEach(() => {
        Container.clear();
        const manager = createControlledLockManager();
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => manager.locks });
        notify.mockReset();
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('read-only tempo detection');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, tempo: BASE_BPM });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        installProject();
        disposeProjection = setupProjectionBridge();
        registerHandlerMap(getAnalysisHandlers());
        registerHandlerMap(getTransportHandlers());
        registerHandlerMap(getArrangementHandlers());
    });

    afterEach(async () => {
        disposeProjection?.();
        disposeProjection = undefined;
        clearUndoHistory();
        clearHandlerRegistry();
        if (audioBufferCache.has('analysis-buffer')) {
            await audioBufferCache.ensureDurable(['analysis-buffer']);
        }
        clearRuntimeCachedAudioBuffers();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('reports the confident doubled MIDI estimate without changing BPM, source, raw authority or history', async () => {
        // Each MIDI grid emits every 60/80 seconds. Their half-beat offset
        // interleaves them at 0.375s: the real estimator therefore reports160.
        const before = getCrdtDoc('root');
        const tracks = structuredClone(trackStore.value);
        const history = structuredClone(undoHistoryStore.value);
        expect(sourceEntry()).toBe((8 * 60) / BASE_BPM);
        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-first' } });
        flushAutomergeStorageWrites();
        expect(notify).toHaveBeenCalledWith(
            `Detected tempo: ${INFERRED_BPM} BPM (${INFERRED_BPM}–${INFERRED_BPM} range)`,
            'success'
        );
        expect.soft(transportStore.value!.tempo).toBe(BASE_BPM);
        expect.soft(sourceEntry()).toBe((8 * 60) / BASE_BPM);
        expect.soft(getCrdtDoc('root')).toBe(before);
        expect(trackStore.value).toEqual(tracks);
        expect(undoHistoryStore.value).toEqual(history);
        expect(trackStore.value!.tracks[1]!.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        authority();
    });

    it('keeps the insufficient-onset warning nonmutating', async () => {
        installProject(false);
        const before = getCrdtDoc('root');
        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-first' } });
        flushAutomergeStorageWrites();
        expect(notify).toHaveBeenCalledWith('Could not confidently detect tempo — add more content first', 'warning');
        expect(getCrdtDoc('root')).toBe(before);
        expect(sourceEntry()).toBe(6);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        authority();
    });

    it('retains real cached-buffer analysis without applying its detected BPM', async () => {
        cacheAudioBuffer({ bufferId: 'analysis-buffer', buffer: pcmBuffer() });
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'audio') {
                    return track;
                }
                return {
                    ...track,
                    clips: [
                        ...track.clips,
                        {
                            ...clip('buffer-target', 'audio', 'audio', 16, 20),
                            audioBufferId: 'analysis-buffer',
                            audioOffsetBeats: 0,
                        },
                    ],
                };
            }),
        });
        authority();
        const before = getCrdtDoc('root');
        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'buffer-target' } });
        flushAutomergeStorageWrites();
        expect(notify).toHaveBeenCalledWith('Detected tempo: 120 BPM');
        expect(getCrdtDoc('root')).toBe(before);
        expect(transportStore.value!.tempo).toBe(BASE_BPM);
        expect(sourceEntry()).toBe(6);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        authority();
    });

    it.each([
        [INFERRED_BPM, INFERRED_BPM],
        [90.4, 90.4],
    ])('adopts explicit input %s as %s through one guarded tempo Undo/Redo', async (enteredBpm, adoptedBpm) => {
        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-first' } });
        expect(transportStore.value!.tempo).toBe(BASE_BPM);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        const beforeTracks = structuredClone(trackStore.value!.tracks);
        await executeAppAction({ type: 'setTempo', payload: { bpm: enteredBpm } });
        authority();
        expect(transportStore.value!.tempo).toBe(adoptedBpm);
        expect(sourceEntry()).toBe(6);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(trackStore.value!.tracks[1]!.clips[0]!.audioOffsetSeconds).toBe(6);
        expect((await undo()).headConsumed).toBe(true);
        authority();
        expect(transportStore.value!.tempo).toBe(BASE_BPM);
        expect(trackStore.value!.tracks).toEqual(beforeTracks);
        expect(sourceEntry()).toBe(6);
        await redo();
        authority();
        expect(transportStore.value!.tempo).toBe(adoptedBpm);
        expect(sourceEntry()).toBe(6);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });
    it('refuses unsupported explicit tempo input without changing source or history', async () => {
        await executeAppAction({ type: 'detectTempo', payload: { clipId: 'midi-first' } });
        const before = getCrdtDoc('root');
        const tracks = structuredClone(trackStore.value);
        const history = structuredClone(undoHistoryStore.value);
        await expect(executeAppAction({ type: 'setTempo', payload: { bpm: 400 } })).rejects.toThrow(
            'Tempo 400 BPM is outside the valid range (20–300)'
        );
        authority();
        expect(getCrdtDoc('root')).toBe(before);
        expect(trackStore.value).toEqual(tracks);
        expect(undoHistoryStore.value).toEqual(history);
        expect(transportStore.value!.tempo).toBe(BASE_BPM);
        expect(sourceEntry()).toBe(6);
    });
});
