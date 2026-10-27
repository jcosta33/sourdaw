import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

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
        ).toEqual(['committed']);
        const before = structuredClone(recordingClip());
        const plan = prepare();
        expect(plan?.clips.map((clip) => clip.clipId)).toEqual(['committed']);
        expect(plan?.clips[0]?.after).toEqual({ audioOffsetSeconds: 2, audioUnwrappedOffsetSeconds: 2 });
        expect(recordingClip()).toEqual(before);
        expect(Object.hasOwn(recordingClip(), 'audioOffsetSeconds')).toBe(false);
        expect(Object.hasOwn(recordingClip(), 'audioUnwrappedOffsetSeconds')).toBe(false);
    });

    it.each(['foreign-take', 'retired-owner', 'published-id'] as const)(
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
            } else {
                flushAutomergeStorageWrites();
            }
            expect(prepare()?.clips.map((clip) => clip.clipId)).toContain(recordingId);
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
