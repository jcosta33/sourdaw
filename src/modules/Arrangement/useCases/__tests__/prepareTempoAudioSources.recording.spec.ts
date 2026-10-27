import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';
import { prepareTempoAudioSources } from '../prepareTempoAudioSources';
import { recordingPassTiming } from '../recording/recordingPassTiming';
import { startRecording } from '../recording/startRecording';

const timeline = {
    secondsAtBeat: (beat: number) => beat / 2,
    beatAtSeconds: (seconds: number) => seconds * 2,
    tempoAtBeat: () => 120,
};
let recordingId: string;

function prepare() {
    return prepareTempoAudioSources({ timeline });
}

function recordingClip() {
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === recordingId);
    if (!clip) {
        throw new Error('Expected the real provisional recording');
    }
    return clip;
}

describe('tempo source preparation while a recording owns unpublished PCM', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('provisional tempo source');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        transportStore.set({ ...defaultTransportState, tempo: 120, playheadPosition: 10 });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'audio',
                    armed: true,
                    clips: [
                        ClipDummy.create({
                            id: 'committed',
                            trackId: 'audio',
                            audioOffsetBeats: 4,
                        }),
                    ],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        const [clip] = startRecording(10, () => null, null);
        if (!clip) {
            throw new Error('Expected real recording admission');
        }
        recordingId = clip.id;
    });

    afterEach(() => {
        clearHandlerRegistry();
        recordingPassTiming.retire(recordingId);
        activeRecordingRef.current = [];
        activeRecordingRef.capturedRootIdentity = null;
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('defers unknown PCM without minting source zero and still preserves committed legacy media', () => {
        expect(
            getCrdtDoc<{ tracks: { tracks: { clips: { id: string }[] }[] } }>('root')!.tracks.tracks[0]!.clips.map(
                (clip) => clip.id
            )
        ).toEqual(['committed', recordingId]);
        const before = structuredClone(recordingClip());
        const plan = prepare();
        expect(plan?.clips.map((clip) => clip.clipId)).toEqual(['committed']);
        expect(plan?.clips[0]?.after).toEqual({ audioOffsetSeconds: 2, audioUnwrappedOffsetSeconds: 2 });
        expect(recordingClip()).toEqual(before);
        expect(Object.hasOwn(recordingClip(), 'audioOffsetSeconds')).toBe(false);
        expect(Object.hasOwn(recordingClip(), 'audioUnwrappedOffsetSeconds')).toBe(false);
    });

    it('keeps an authenticated published provisional rectangle deferred before PCM has a basis', () => {
        flushAutomergeStorageWrites();
        expect(prepare()?.clips.map((clip) => clip.clipId)).toEqual(['committed']);
        expect(Object.hasOwn(recordingClip(), 'audioOffsetSeconds')).toBe(false);
    });

    it.each(['foreign-take', 'retired-owner', 'published-id', 'root-moved'] as const)(
        'gives no deferred-source exemption to %s',
        (change) => {
            if (change === 'foreign-take') {
                takeLaneStore.set({
                    lanes: takeLaneStore.value!.lanes.map((lane) => ({
                        ...lane,
                        takes: lane.takes.map((take) => ({ ...take, id: 'foreign-take' })),
                    })),
                });
            } else if (change === 'retired-owner') {
                recordingPassTiming.retire(recordingId);
            } else if (change === 'root-moved') {
                removeCrdtDoc('root');
                createCrdtDoc('root');
            } else {
                flushAutomergeStorageWrites();
                recordingPassTiming.retire(recordingId);
            }
            expect(prepare()?.clips.map((clip) => clip.clipId)).toContain(recordingId);
        }
    );

    it.each([false, true])(
        'adopts tempo beside committed media without inventing PCM zero (published=%s)',
        async (published) => {
            if (published) {
                flushAutomergeStorageWrites();
            }
            registerHandlerMap(getTransportHandlers());
            await executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true });
            expect(transportStore.value?.tempo).toBe(60);
            const committed = trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === 'committed');
            expect(committed?.audioOffsetSeconds).toBe(2);
            expect(committed?.audioUnwrappedOffsetSeconds).toBe(2);
            expect(Object.hasOwn(recordingClip(), 'audioOffsetSeconds')).toBe(false);
            expect(Object.hasOwn(recordingClip(), 'audioUnwrappedOffsetSeconds')).toBe(false);
        }
    );

    it.each(['retired', 'peer-rectangle', 'peer-recreated'] as const)(
        'refuses changed recording authority before tempo commit: %s',
        async (change) => {
            flushAutomergeStorageWrites();
            const handlers = getTransportHandlers();
            registerHandlerMap({
                ...handlers,
                setTempo: {
                    ...handlers.setTempo,
                    execute: (action, context) => {
                        const result = handlers.setTempo.execute(action, context);
                        if (change === 'retired') {
                            recordingPassTiming.retire(recordingId);
                        } else {
                            mutateCrdtDoc<{ tracks: { tracks: { clips: { id: string; startBeat: number }[] }[] } }>({
                                id: 'root',
                                changeFn: (project) => {
                                    const clip = project.tracks.tracks[0]!.clips.find(
                                        (clip) => clip.id === recordingId
                                    )!;
                                    clip.startBeat = 9;
                                },
                            });
                        }
                        return result;
                    },
                },
            });
            await expect(
                executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true })
            ).rejects.toThrow('Action conflicts with current project state: setTempo');
            expect(transportStore.value?.tempo).toBe(120);
            expect(getCrdtDoc<{ transport: { tempo: number } }>('root')?.transport.tempo).toBe(120);
            expect(Object.hasOwn(recordingClip(), 'audioOffsetSeconds')).toBe(false);
        }
    );

    it('rejects a recreated raw clip incarnation before source preflight', () => {
        flushAutomergeStorageWrites();
        mutateCrdtDoc<{ tracks: { tracks: { clips: { id: string }[] }[] } }>({
            id: 'root',
            changeFn: (project) => {
                const clips = project.tracks.tracks[0]!.clips;
                const index = clips.findIndex((clip) => clip.id === recordingId);
                clips.splice(index, 1, { ...clips[index]!, id: recordingId });
            },
        });
        expect(recordingPassTiming.ownedTakes(recordingId)).toBeUndefined();
        expect(prepare()?.clips.map((clip) => clip.clipId)).toContain(recordingId);
    });

    it('does not bind a foreign identical first publication before the recording birth publishes', () => {
        recordingPassTiming.retire(recordingId);
        // Hold the real producer's owned birth outside raw truth.
        const pending = runWithAutomergeStorageTransaction(undefined, () => startRecording(12, () => null, null));
        if (pending.status !== 'returned' || !pending.value[0]) {
            throw new Error('Expected a held recording birth');
        }
        const clip = pending.value[0];
        expect(recordingPassTiming.ownedTakes(clip.id)).toBeDefined();
        mutateCrdtDoc<{ tracks: { tracks: { clips: (typeof clip)[] }[] } }>({
            id: 'root',
            changeFn: (project) => {
                project.tracks.tracks[0]!.clips.push({ ...clip, id: clip.id });
            },
        });
        expect(recordingPassTiming.ownedTakes(clip.id)).toBeUndefined();
        pending.abort();
        recordingPassTiming.retire(clip.id);
    });

    it('does not hide a present malformed modern source facet on a recording owner', () => {
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) =>
                    clip.id === recordingId ? { ...clip, audioLoopPassOriginBeat: 10 } : clip
                ),
            })),
        });
        expect(prepare()).toBeNull();
    });
});
