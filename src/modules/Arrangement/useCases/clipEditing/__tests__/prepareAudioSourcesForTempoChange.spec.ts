import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    tracks: { value: null as TrackStoreState | null },
    lanes: { value: null as TakeLaneStoreState | null },
    trackWrites: 0,
    laneWrites: 0,
    tempo: 120,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    readTempoAtBeat: () => mocks.tempo,
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.tracks.value;
        },
        set(value: TrackStoreState) {
            mocks.tracks.value = value;
            mocks.trackWrites++;
        },
    },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.lanes.value;
        },
        set(value: TakeLaneStoreState) {
            mocks.lanes.value = value;
            mocks.laneWrites++;
        },
    },
}));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { type TrackStoreState } from '../../../stores/trackStore';
import { prepareAudioSourcesForTempoChange } from '../prepareAudioSourcesForTempoChange';

function tracks(): TrackStoreState {
    return mocks.tracks.value as TrackStoreState;
}

function lanes(): TakeLaneStoreState {
    return mocks.lanes.value as TakeLaneStoreState;
}

describe('prepareAudioSourcesForTempoChange', () => {
    beforeEach(() => {
        mocks.trackWrites = 0;
        mocks.laneWrites = 0;
        mocks.tempo = 120;
        const signed = ClipDummy.create({
            id: 'signed',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 8,
            audioOffsetBeats: -2,
        });
        const zero = ClipDummy.create({
            id: 'zero',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 8,
            audioOffsetBeats: 99,
            audioOffsetSeconds: 0,
        });
        const inactive = ClipDummy.create({
            id: 'inactive',
            trackId: 'track-1',
            startBeat: 4,
            endBeat: 8,
            audioOffsetBeats: 2,
        });
        mocks.tracks.value = {
            tracks: [
                TrackDummy.create({
                    clips: [signed, zero],
                    alternatives: [
                        { id: 'active', name: 'Active', clips: [] },
                        { id: 'inactive-alt', name: 'Inactive', clips: [inactive] },
                    ],
                    activeAlternativeId: 'active',
                }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        };
        mocks.lanes.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'signed',
                            name: 'Take',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 8, takeId: 'take-1' }],
                },
            ],
        };
    });

    it('captures signed clip entry, inactive alternatives and take depth while canonical zero stays authoritative', () => {
        const prepared = prepareAudioSourcesForTempoChange({ nextTempoAtBeat: () => 60 });
        expect(
            prepared?.transition.clips.map((source) => [source.clipId, source.alternativeId, source.audioOffsetSeconds])
        ).toEqual([
            ['signed', null, -1],
            ['inactive', 'inactive-alt', 1],
        ]);
        expect(prepared?.transition.takes.map((source) => [source.takeId, source.sourceOffsetSeconds])).toEqual([
            ['take-1', 1],
        ]);
        expect(prepared?.apply()).toBe(true);
        expect(tracks().tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(-1);
        expect(tracks().tracks[0]?.clips[1]?.audioOffsetSeconds).toBe(0);
        expect(tracks().tracks[0]?.alternatives[1]?.clips[0]?.audioOffsetSeconds).toBe(1);
        expect(lanes().lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(1);

        mocks.tempo = 60;
        const inverse = prepareAudioSourcesForTempoChange({
            nextTempoAtBeat: () => 120,
            replay: { ...prepared!.transition, direction: 'restore' },
        });
        expect(inverse?.apply()).toBe(true);
        expect(tracks().tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(tracks().tracks[0]?.alternatives[1]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(lanes().lanes[0]?.takes[0]).not.toHaveProperty('sourceOffsetSeconds');
    });

    it('refuses a changed source or geometry before any owner write', () => {
        const prepared = prepareAudioSourcesForTempoChange({ nextTempoAtBeat: () => 60 });
        tracks().tracks[0]!.clips[0] = { ...tracks().tracks[0]!.clips[0]!, audioOffsetSeconds: 7 };
        expect(prepared?.apply()).toBe(false);
        expect(mocks.trackWrites).toBe(0);
        expect(mocks.laneWrites).toBe(0);
    });

    it('guards the media owner of a take even when its clip already has canonical source time', () => {
        tracks().tracks[0]!.clips[0] = { ...tracks().tracks[0]!.clips[0]!, audioOffsetSeconds: -1 };
        const prepared = prepareAudioSourcesForTempoChange({ nextTempoAtBeat: () => 60 });
        expect(prepared?.transition.takes).toHaveLength(1);
        tracks().tracks[0]!.clips[0] = { ...tracks().tracks[0]!.clips[0]!, audioBufferId: 'peer-media' };
        expect(prepared?.apply()).toBe(false);
        expect(mocks.trackWrites).toBe(0);
        expect(mocks.laneWrites).toBe(0);
    });

    it('refuses a duplicated captured take identity before applying either owner write', () => {
        const prepared = prepareAudioSourcesForTempoChange({ nextTempoAtBeat: () => 60 });
        lanes().lanes[0]!.takes.push(lanes().lanes[0]!.takes[0]!);
        expect(prepared?.apply()).toBe(false);
        expect(mocks.trackWrites).toBe(0);
        expect(mocks.laneWrites).toBe(0);
    });

    it('refuses a nonfinite legacy source rather than committing a tempo edit without its media entry', () => {
        tracks().tracks[0]!.clips[0] = { ...tracks().tracks[0]!.clips[0]!, audioOffsetBeats: Infinity };
        expect(prepareAudioSourcesForTempoChange({ nextTempoAtBeat: () => 60 })).toBeNull();
        expect(mocks.trackWrites).toBe(0);
        expect(mocks.laneWrites).toBe(0);
    });

    it('rejects a malformed replay capture without changing owners', () => {
        const prepared = prepareAudioSourcesForTempoChange({ nextTempoAtBeat: () => 60 });
        const corrupt = {
            ...prepared!.transition,
            clips: [{ ...prepared!.transition.clips[0]!, extra: true }],
        };
        expect(prepareAudioSourcesForTempoChange({ nextTempoAtBeat: () => 60, replay: corrupt })).toBeNull();
        expect(mocks.trackWrites).toBe(0);
        expect(mocks.laneWrites).toBe(0);
    });
});
