import { beforeEach, describe, expect, it, vi } from 'vitest';

import { placeTakeOnClipMedia, startFirstPassAtRecordPoint, type Take } from '../../../models/TakeLane';
import { type TempoTimeline } from '../../../models/TempoTimeline';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { placeRecordingTakes } from '../placeRecordingTakes';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
    set: vi.fn<(next: TakeLaneStoreState) => void>(),
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: mocks.set,
    },
}));

// One flat 120 BPM timeline for the use case: two beats a second.
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    readSecondsAtBeat: ({ beat }: { beat: number }) => beat / 2,
    readBeatAtSamples: ({ samples }: { samples: number }) => samples * 2,
    readTempoAtBeat: () => 120,
}));

function take(id: string, clipId: string, startBeat: number, endBeat: number, sourceOffsetBeats?: number): Take {
    const result: Take = { id, clipId, name: id, startBeat, endBeat, selected: false };
    if (sourceOffsetBeats !== undefined) {
        result.sourceOffsetBeats = sourceOffsetBeats;
    }
    return result;
}

const flat120: TempoTimeline = {
    secondsAtBeat: (beat) => beat / 2,
    beatAtSeconds: (seconds) => seconds * 2,
    tempoAtBeat: () => 120,
};

/** 120 BPM up to beat 10, 60 BPM after it. */
const slowingAt10: TempoTimeline = {
    secondsAtBeat: (beat) => (beat <= 10 ? beat / 2 : 5 + (beat - 10)),
    beatAtSeconds: (seconds) => (seconds <= 5 ? seconds * 2 : 10 + (seconds - 5)),
    tempoAtBeat: (beat) => (beat < 10 ? 120 : 60),
};

function placement(take: Take): [number, number | undefined, number | undefined] {
    return [take.startBeat, take.passAnchorSeconds, take.passDepthSeconds];
}

describe('startFirstPassAtRecordPoint', () => {
    it('starts the first pass of a recording begun inside the loop at the record point', () => {
        expect(startFirstPassAtRecordPoint(take('pass-1', 'rec', 8, 16, 0), 12).startBeat).toBe(12);
    });

    it('leaves every other take where it is', () => {
        const runUpPass = take('pass-1', 'rec', 2, 6, 1);
        expect(startFirstPassAtRecordPoint(runUpPass, 1)).toBe(runUpPass);
        const laterPass = take('pass-2', 'rec', 8, 16, 4);
        expect(startFirstPassAtRecordPoint(laterPass, 12)).toBe(laterPass);
        const opening = take('take-1', 'rec', 12, 20);
        expect(startFirstPassAtRecordPoint(opening, 12)).toBe(opening);
    });
});

describe('placeTakeOnClipMedia', () => {
    it('anchors a run-up pass at the loop start, its material the capture of that beat', () => {
        // Loop [2,6) recorded from beat 1, the capture beginning 0.25 s (half a
        // beat) earlier on a clip opening on that origin.
        const placed = placeTakeOnClipMedia(take('pass-2', 'rec', 2, 6, 5), {
            recordPointBeat: 1,
            mediaOriginSeconds: 0.25,
            clipMediaOriginSeconds: 0.25,
            timeline: flat120,
        });

        // Beat 2 sounds 0.75 s into the clip's media; the lap began 2.75 s in.
        expect(placement(placed)).toEqual([2, 0.75, 2.75]);
        // The minted depth stays as the recorder wrote it.
        expect(placed.sourceOffsetBeats).toBe(5);
    });

    it('anchors the passes of a recording begun inside the loop against a clip opening at the loop start', () => {
        // Loop [8,16) recorded from beat 12 with no latency: the clip opens at 8
        // with a media offset of -4, so its media begins at 6 s, on beat 12.
        const input = { recordPointBeat: 12, mediaOriginSeconds: 6, clipMediaOriginSeconds: 6, timeline: flat120 };

        expect(placement(placeTakeOnClipMedia(take('pass-1', 'rec', 8, 16, 0), input))).toEqual([12, 0, 0]);
        expect(placement(placeTakeOnClipMedia(take('pass-2', 'rec', 8, 16, 4), input))).toEqual([8, -2, 2]);
        expect(placement(placeTakeOnClipMedia(take('pass-3', 'rec', 8, 16, 12), input))).toEqual([8, -2, 6]);
    });

    it('measures anchor and depth in seconds across a tempo change', () => {
        // Loop [8,16), recorded from beat 12 at 60 BPM with 20 ms of latency,
        // the tempo having dropped from 120 at beat 10: the capture and the
        // clip's media both begin at 6.98 s.
        const input = {
            recordPointBeat: 12,
            mediaOriginSeconds: 6.98,
            clipMediaOriginSeconds: 6.98,
            timeline: slowingAt10,
        };

        const [pass1Start, pass1Anchor, pass1Depth] = placement(
            placeTakeOnClipMedia(take('pass-1', 'rec', 8, 16, 0), input)
        );
        const [pass2Start, pass2Anchor, pass2Depth] = placement(
            placeTakeOnClipMedia(take('pass-2', 'rec', 8, 16, 4), input)
        );

        // Pass 1 sounds from the record point, 0.02 s into the media.
        expect(pass1Start).toBe(12);
        expect(pass1Anchor).toBeCloseTo(0.02, 9);
        expect(pass1Depth).toBeCloseTo(0.02, 9);
        // Pass 2 sounds from the loop start, 2.98 s before the media begins,
        // on what was captured when the playhead wrapped: 4 s of 60 BPM after
        // the record point.
        expect(pass2Start).toBe(8);
        expect(pass2Anchor).toBeCloseTo(-2.98, 9);
        expect(pass2Depth).toBeCloseTo(4.02, 9);
    });

    it('walks whole loops through the tempo change inside the loop', () => {
        // Pass 3 of the same recording: the 4 s first lap, then one whole lap
        // of 1 s at 120 BPM and 6 s at 60 BPM, 11.02 s into the media.
        const placed = placeTakeOnClipMedia(take('pass-3', 'rec', 8, 16, 12), {
            recordPointBeat: 12,
            mediaOriginSeconds: 6.98,
            clipMediaOriginSeconds: 6.98,
            timeline: slowingAt10,
        });

        expect(placed.passDepthSeconds).toBeCloseTo(11.02, 9);
        expect(placed.passAnchorSeconds).toBeCloseTo(-2.98, 9);
    });

    it('measures a later pass through whole loops of the tempo map', () => {
        // Loop [16,24) at 60 BPM, run up from 12 after the drop at 10: pass 3 is
        // the run-up, then two whole loops of 8 s, into the media.
        const placed = placeTakeOnClipMedia(take('pass-3', 'rec', 16, 24, 20), {
            recordPointBeat: 12,
            mediaOriginSeconds: 3.98,
            clipMediaOriginSeconds: 3.98,
            timeline: slowingAt10,
        });

        expect(placed.passDepthSeconds).toBeCloseTo(4 + 16 + 3.02, 9);
        expect(placed.passAnchorSeconds).toBeCloseTo(7.02, 9);
    });

    it('places no take that plays its clip’s own media', () => {
        const opening = take('take-1', 'rec', 1, 5);
        expect(
            placeTakeOnClipMedia(opening, {
                recordPointBeat: 1,
                mediaOriginSeconds: 0.25,
                clipMediaOriginSeconds: 0.25,
                timeline: flat120,
            })
        ).toBe(opening);
    });
});

describe('placeRecordingTakes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('places only the passes of the recording clip', () => {
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [take('first', 'rec', 1, 5), take('pass-1', 'rec', 2, 6, 1), take('other', 'old', 2, 6, 3)],
                    activeCompRegions: [],
                },
            ],
        };

        // The capture began half a beat before the record point, on a clip
        // opening on that origin.
        placeRecordingTakes({
            clipId: 'rec',
            recordPointBeat: 1,
            mediaOriginSeconds: 0.25,
            clipMediaOriginSeconds: 0.25,
        });

        const written = mocks.set.mock.calls[0]![0].lanes[0]!.takes;
        expect(written.map((entry) => [entry.id, entry.passAnchorSeconds, entry.passDepthSeconds])).toEqual([
            ['first', undefined, undefined],
            ['pass-1', 0.75, 0.75],
            ['other', undefined, undefined],
        ]);
    });
});
