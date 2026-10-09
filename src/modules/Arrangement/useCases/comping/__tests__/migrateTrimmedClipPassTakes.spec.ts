import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Take } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { type TrackStoreState } from '../../../stores/trackStore';
import { migrateTrimmedClipPassTakes } from '../migrateTrimmedClipPassTakes';

const mocks = vi.hoisted(() => {
    const trackStoreValue: { value: TrackStoreState | null } = { value: null };
    const laneStoreValue: { value: TakeLaneStoreState | null } = { value: null };
    return { trackStoreValue, laneStoreValue, laneStoreSet: vi.fn() };
});

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.laneStoreValue.value;
        },
        set: mocks.laneStoreSet,
    },
}));

/** A loop pass as a pre-#4987 build saved it: a media depth, no placement seconds. */
function passTake(
    id: string,
    startBeat: number,
    endBeat: number,
    sourceOffsetBeats: number,
    overrides?: Partial<Take>
): Take {
    return { id, clipId: 'clip-1', name: id, startBeat, endBeat, selected: false, sourceOffsetBeats, ...overrides };
}

function seedTracks(clips: ReturnType<typeof ClipDummy.create>[]): void {
    mocks.trackStoreValue.value = {
        tracks: [TrackDummy.create({ id: 'track-1', clips })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    };
}

function seedLanes(takes: Take[]): void {
    mocks.laneStoreValue.value = {
        lanes: [{ id: 'lane-1', trackId: 'track-1', takes, activeCompRegions: [] }],
    };
}

function writtenTakes(): Take[] {
    const write = mocks.laneStoreSet.mock.calls[0]![0] as TakeLaneStoreState;
    return write.lanes[0]!.takes;
}

describe('migrateTrimmedClipPassTakes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
        mocks.laneStoreValue.value = null;
    });

    it('clamps the loop passes a start trim left spanning the trimmed-away material', () => {
        // Loop [0,4) recorded for two passes, then the clip start trimmed to
        // beat 1 on a build that did not carry takes along (#4996).
        seedTracks([ClipDummy.create({ id: 'clip-1', startBeat: 1, endBeat: 8, audioOffsetBeats: 1 })]);
        seedLanes([passTake('pass-1', 0, 4, 0), passTake('pass-2', 0, 4, 4)]);

        migrateTrimmedClipPassTakes();

        expect(mocks.laneStoreSet).toHaveBeenCalledTimes(1);
        expect(writtenTakes()).toEqual([passTake('pass-1', 1, 4, 0), passTake('pass-2', 1, 4, 4)]);
    });

    it('keeps a placed pass its placement fields while clamping its span', () => {
        seedTracks([ClipDummy.create({ id: 'clip-1', startBeat: 3, endBeat: 12, audioOffsetBeats: 1 })]);
        seedLanes([passTake('pass-2', 2, 6, 1, { passAnchorSeconds: 1.5, passDepthSeconds: 0.75 })]);

        migrateTrimmedClipPassTakes();

        expect(writtenTakes()).toEqual([
            passTake('pass-2', 3, 6, 1, { passAnchorSeconds: 1.5, passDepthSeconds: 0.75 }),
        ]);
    });

    it('clamps a MIDI pass by the offset field its own type reads', () => {
        seedTracks([ClipDummy.create({ id: 'clip-1', type: 'midi', startBeat: 1, endBeat: 8, midiOffsetBeats: 1 })]);
        seedLanes([passTake('pass-2', 0, 4, 4)]);

        migrateTrimmedClipPassTakes();

        expect(writtenTakes()[0]!.startBeat).toBe(1);
    });

    it('leaves a legitimate pass reaching before the record point alone', () => {
        // Recorded from beat 2 inside loop [0,4) on a pre-#4987 build: the clip
        // commits at the record point on its media origin, and pass 2 spans the
        // loop from before it. Nothing was trimmed — no offset evidence.
        seedTracks([ClipDummy.create({ id: 'clip-1', startBeat: 2, endBeat: 8 })]);
        seedLanes([passTake('pass-1', 2, 8, 0), passTake('pass-2', 0, 4, 2)]);

        migrateTrimmedClipPassTakes();

        expect(mocks.laneStoreSet).not.toHaveBeenCalled();
    });

    it('round-trips a current document without touching the lane', () => {
        // Post-#4987 commit of a recording begun inside the loop: the clip opens
        // at the earliest pass with negative media offset (leading silence), and
        // every pass carries its placement. A run-up recording keeps its takes at
        // or after its clip's start.
        seedTracks([
            ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 8, audioOffsetBeats: -2 }),
            ClipDummy.create({ id: 'clip-2', startBeat: 1, endBeat: 12 }),
        ]);
        mocks.laneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        passTake('pass-1', 2, 4, 0, { passAnchorSeconds: 0, passDepthSeconds: 0 }),
                        passTake('pass-2', 0, 4, 4, { passAnchorSeconds: -2, passDepthSeconds: 2 }),
                        { id: 'manual', clipId: 'clip-1', name: 'manual', startBeat: 0, endBeat: 8, selected: false },
                    ],
                    activeCompRegions: [],
                },
                {
                    id: 'lane-2',
                    trackId: 'track-1',
                    takes: [passTake('run-up-1', 2, 6, 1)],
                    activeCompRegions: [],
                },
            ],
        };

        migrateTrimmedClipPassTakes();

        expect(mocks.laneStoreSet).not.toHaveBeenCalled();
    });

    it('leaves a manual take that spans before its clip alone', () => {
        seedTracks([ClipDummy.create({ id: 'clip-1', startBeat: 1, endBeat: 8, audioOffsetBeats: 1 })]);
        seedLanes([{ id: 'manual', clipId: 'clip-1', name: 'manual', startBeat: 0, endBeat: 8, selected: false }]);

        migrateTrimmedClipPassTakes();

        expect(mocks.laneStoreSet).not.toHaveBeenCalled();
    });

    it('leaves a pass whose whole span the trim consumed alone', () => {
        // Clamping would push the take's start past its end, so the store's
        // validator would drop it whole; the dead span is inert instead.
        seedTracks([ClipDummy.create({ id: 'clip-1', startBeat: 5, endBeat: 8, audioOffsetBeats: 5 })]);
        seedLanes([passTake('pass-1', 0, 4, 0)]);

        migrateTrimmedClipPassTakes();

        expect(mocks.laneStoreSet).not.toHaveBeenCalled();
    });

    it('is idempotent across reloads of the migrated state', () => {
        seedTracks([ClipDummy.create({ id: 'clip-1', startBeat: 1, endBeat: 8, audioOffsetBeats: 1 })]);
        seedLanes([passTake('pass-1', 0, 4, 0), passTake('pass-2', 0, 4, 4)]);

        migrateTrimmedClipPassTakes();
        mocks.laneStoreValue.value = mocks.laneStoreSet.mock.calls[0]![0] as TakeLaneStoreState;

        migrateTrimmedClipPassTakes();

        expect(mocks.laneStoreSet).toHaveBeenCalledTimes(1);
    });

    it('skips a take whose clip no longer exists', () => {
        seedTracks([ClipDummy.create({ id: 'clip-1', startBeat: 1, endBeat: 8, audioOffsetBeats: 1 })]);
        seedLanes([{ ...passTake('ghost', 0, 4, 0), clipId: 'gone' }]);

        migrateTrimmedClipPassTakes();

        expect(mocks.laneStoreSet).not.toHaveBeenCalled();
    });
});
