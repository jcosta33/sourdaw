import { getObjectId } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    getCurrentAutomergeStorageMutationOwner,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    readOwnedProjectPublications,
    subscribeToCrdtChanges,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore, type Clip } from '../../stores/trackStore';
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

type RawRecordingProject = {
    tracks: { tracks: { clips: Clip[] }[] };
    takeLanes: { lanes: { takes: { clipId: string }[] }[] };
};
function rawClips(clipId: string): Clip[] {
    const project = getCrdtDoc<RawRecordingProject>('root');
    if (!project) {
        throw new Error('Expected the current raw project');
    }
    return project.tracks.tracks.flatMap((track) => track.clips).filter((clip) => clip.id === clipId);
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
            expect(recordingPassTiming.ownedTakes(recordingId)).toBeDefined();
            if (change === 'foreign-take') {
                takeLaneStore.set({
                    lanes: takeLaneStore.value!.lanes.map((lane) => ({
                        ...lane,
                        takes: lane.takes.map((take) => ({ ...take, id: 'foreign-take' })),
                    })),
                });
                const takes = takeLaneStore.value!.lanes.flatMap((lane) => lane.takes);
                const recordingTakes = takes.filter((take) => take.clipId === recordingId);
                expect(recordingTakes.map((take) => take.id)).toEqual(['foreign-take']);
            } else if (change === 'retired-owner') {
                recordingPassTiming.retire(recordingId);
                expect(recordingPassTiming.ownedTakes(recordingId)).toBeUndefined();
            } else if (change === 'root-moved') {
                const originalRoot = getCrdtDoc('root');
                removeCrdtDoc('root');
                createCrdtDoc('root');
                expect(getCrdtDoc('root')).not.toBe(originalRoot);
                expect(recordingPassTiming.ownedTakes(recordingId)).toBeUndefined();
            } else {
                flushAutomergeStorageWrites();
                expect(rawClips(recordingId)).toHaveLength(1);
                const objectId = getObjectId(rawClips(recordingId)[0]);
                // Beginning a new timing token cannot inherit a published ID.
                recordingPassTiming.begin(recordingId, 10, () => null, true);
                expect(getObjectId(rawClips(recordingId)[0])).toBe(objectId);
                expect(recordingPassTiming.ownedTakes(recordingId)).toBeUndefined();
            }
            expect(prepare()?.clips.map((clip) => clip.clipId)).toContain(recordingId);
        }
    );

    it.each([false, true])(
        'adopts tempo beside already published provisional media without inventing PCM zero (additional flush=%s)',
        async (flushAgain) => {
            expect(rawClips(recordingId)).toHaveLength(1);
            if (flushAgain) {
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
            const before = structuredClone(recordingClip());
            const originalObjectId = getObjectId(rawClips(recordingId)[0]);
            expect(originalObjectId).toBeTypeOf('string');
            let changed = false;
            const handlers = getTransportHandlers();
            registerHandlerMap({
                ...handlers,
                setTempo: {
                    ...handlers.setTempo,
                    execute: (action, context) => {
                        const result = handlers.setTempo.execute(action, context);
                        if (result instanceof Promise) {
                            throw new Error('Expected synchronous tempo execution');
                        }
                        expect(result).toMatchObject({ status: 'written' });
                        if (change === 'retired') {
                            recordingPassTiming.retire(recordingId);
                        } else {
                            mutateCrdtDoc<RawRecordingProject>({
                                id: 'root',
                                changeFn: (project) => {
                                    const clips = project.tracks.tracks[0]!.clips;
                                    const index = clips.findIndex((clip) => clip.id === recordingId);
                                    if (change === 'peer-recreated') {
                                        clips.splice(index, 1, { ...clips[index]!, id: recordingId });
                                    } else {
                                        clips[index]!.startBeat = 9;
                                    }
                                },
                            });
                        }
                        const [raw] = rawClips(recordingId);
                        expect(raw).toBeDefined();
                        if (change === 'peer-recreated') {
                            expect(raw).toEqual(before);
                            expect(getObjectId(raw)).not.toBe(originalObjectId);
                            expect(recordingPassTiming.ownedTakes(recordingId)).toBeUndefined();
                        } else {
                            expect(getObjectId(raw)).toBe(originalObjectId);
                            if (change === 'peer-rectangle') {
                                expect(raw?.startBeat).toBe(9);
                                expect(recordingPassTiming.ownedTakes(recordingId)).toBeDefined();
                            } else {
                                expect(raw).toEqual(before);
                                expect(recordingPassTiming.ownedTakes(recordingId)).toBeUndefined();
                            }
                        }
                        changed = true;
                        return result;
                    },
                },
            });
            await expect(
                executeAppAction({ type: 'setTempo', payload: { bpm: 60 } }, { skipUndo: true })
            ).rejects.toThrow('Action conflicts with current project state: setTempo');
            expect(changed).toBe(true);
            expect(transportStore.value?.tempo).toBe(120);
            expect(getCrdtDoc<{ transport: { tempo: number } }>('root')?.transport.tempo).toBe(120);
            expect(Object.hasOwn(recordingClip(), 'audioOffsetSeconds')).toBe(false);
        }
    );

    it('rejects a recreated raw clip incarnation before source preflight', () => {
        flushAutomergeStorageWrites();
        const before = structuredClone(recordingClip());
        const objectId = getObjectId(rawClips(recordingId)[0]);
        expect(objectId).toBeTypeOf('string');
        mutateCrdtDoc<{ tracks: { tracks: { clips: { id: string }[] }[] } }>({
            id: 'root',
            changeFn: (project) => {
                const clips = project.tracks.tracks[0]!.clips;
                const index = clips.findIndex((clip) => clip.id === recordingId);
                clips.splice(index, 1, { ...clips[index]!, id: recordingId });
            },
        });
        expect(rawClips(recordingId)).toEqual([before]);
        expect(getObjectId(rawClips(recordingId)[0])).not.toBe(objectId);
        expect(recordingPassTiming.ownedTakes(recordingId)).toBeUndefined();
        expect(prepare()?.clips.map((clip) => clip.clipId)).toContain(recordingId);
    });

    it('observes an atomic real recording birth before a foreign duplicate invalidates it', () => {
        recordingPassTiming.retire(recordingId);
        const observations: { clipIds: string[]; takeClipIds: string[] }[] = [];
        const unsubscribe = subscribeToCrdtChanges((docId) => {
            if (docId !== 'root') {
                return;
            }
            const project = getCrdtDoc<RawRecordingProject>('root')!;
            observations.push({
                clipIds: project.tracks.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
                takeClipIds: project.takeLanes.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId)),
            });
        });
        // startRecording commits its own owner even inside another open scope.
        const pending = runWithAutomergeStorageTransaction(undefined, () => startRecording(12, () => null, null));
        unsubscribe();
        if (pending.status !== 'returned' || !pending.value[0]) {
            pending.abort();
            throw new Error('Expected a real recording birth');
        }
        const clip = pending.value[0];
        try {
            expect(observations).toHaveLength(1);
            expect(observations[0]?.clipIds.filter((id) => id === clip.id)).toEqual([clip.id]);
            expect(observations[0]?.takeClipIds.filter((id) => id === clip.id)).toEqual([clip.id]);
            expect(rawClips(clip.id)).toEqual([clip]);
            const objectId = getObjectId(rawClips(clip.id)[0]);
            expect(objectId).toBeTypeOf('string');
            expect(recordingPassTiming.ownedTakes(clip.id)?.rawClipObjectId).toBe(objectId);
            mutateCrdtDoc<RawRecordingProject>({
                id: 'root',
                changeFn: (project) => {
                    project.tracks.tracks[0]!.clips.push({ ...clip, id: clip.id });
                },
            });
            expect(rawClips(clip.id)).toEqual([clip, clip]);
            expect(new Set(rawClips(clip.id).map((row) => getObjectId(row))).size).toBe(2);
            expect(recordingPassTiming.ownedTakes(clip.id)).toBeUndefined();
        } finally {
            pending.abort();
            recordingPassTiming.retire(clip.id);
        }
    });

    it.each(['owned', 'foreign'] as const)(
        'recording observer authenticates the first raw incarnation using its publication receipt: %s',
        (birth) => {
            const clip = { ...recordingClip(), id: 'first-publication-observer', startBeat: 12, endBeat: 12 };
            expect(rawClips(clip.id)).toEqual([]);
            // Probe the real observer/receipt seam directly. The public producer
            // above is atomic and cannot be held unpublished by an outer scope.
            const pending = runWithAutomergeStorageTransaction(undefined, () => {
                recordingPassTiming.begin(clip.id, 12, () => null, true);
                const owner = getCurrentAutomergeStorageMutationOwner();
                if (!owner) {
                    throw new Error('Expected a real publication owner');
                }
                trackStore.set({
                    ...trackStore.value!,
                    tracks: trackStore.value!.tracks.map((track) => ({ ...track, clips: [...track.clips, clip] })),
                });
                return owner;
            });
            if (pending.status !== 'returned') {
                pending.abort();
                recordingPassTiming.retire(clip.id);
                throw pending.error;
            }
            const owner = pending.value;
            try {
                expect(rawClips(clip.id)).toEqual([]);
                expect(readOwnedProjectPublications(owner)).toEqual([]);
                expect(recordingPassTiming.ownedTakes(clip.id)).toBeDefined();
                if (birth === 'owned') {
                    pending.commit();
                    expect(readOwnedProjectPublications(owner).map((publication) => publication.docId)).toEqual([
                        'root',
                    ]);
                    expect(recordingPassTiming.ownedTakes(clip.id)?.rawClipObjectId).toBe(
                        getObjectId(rawClips(clip.id)[0])
                    );
                } else {
                    expect(getCurrentAutomergeStorageMutationOwner()).toBeUndefined();
                    mutateCrdtDoc<RawRecordingProject>({
                        id: 'root',
                        changeFn: (project) => {
                            project.tracks.tracks[0]!.clips.push({ ...clip, id: clip.id });
                        },
                    });
                    expect(readOwnedProjectPublications(owner)).toEqual([]);
                    expect(rawClips(clip.id)).toEqual([clip]);
                    expect(getObjectId(rawClips(clip.id)[0])).toBeTypeOf('string');
                    expect(recordingPassTiming.ownedTakes(clip.id)).toBeUndefined();
                }
                expect(rawClips(clip.id)).toEqual([clip]);
            } finally {
                pending.abort();
                recordingPassTiming.retire(clip.id);
            }
        }
    );

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
