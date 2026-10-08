import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    placeTakeOnClipMedia,
    type RecordingTimeline,
    startFirstPassAtRecordPoint,
    type Take,
} from '../../../models/TakeLane';
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
    readTempoAtBeat: () => 120,
}));

function take(id: string, clipId: string, startBeat: number, endBeat: number, sourceOffsetBeats?: number): Take {
    const result: Take = { id, clipId, name: id, startBeat, endBeat, selected: false };
    if (sourceOffsetBeats !== undefined) {
        result.sourceOffsetBeats = sourceOffsetBeats;
    }
    return result;
}

const flat120: RecordingTimeline = { secondsAtBeat: (beat) => beat / 2, tempoAtBeat: () => 120 };

/** 120 BPM up to beat 10, 60 BPM after it. */
const slowingAt10: RecordingTimeline = {
    secondsAtBeat: (beat) => (beat <= 10 ? beat / 2 : 5 + (beat - 10)),
    tempoAtBeat: (beat) => (beat < 10 ? 120 : 60),
};

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
    it('places a run-up pass at the loop start, its material the capture of that beat', () => {
        // Loop [2,6) recorded from beat 1, the capture beginning 0.25 s (half a
        // beat) earlier on a clip opening on its origin, 0.5.
        const placed = placeTakeOnClipMedia(take('pass-2', 'rec', 2, 6, 5), {
            recordPointBeat: 1,
            mediaOriginSeconds: 0.25,
            clipMediaOriginBeat: 0.5,
            timeline: flat120,
        });

        expect(placed.passStartBeats).toBe(1.5);
        expect(placed.sourceOffsetBeats).toBe(5.5);
    });

    it('places the passes of a recording begun inside the loop against a clip opening at the loop start', () => {
        // Loop [8,16) recorded from beat 12 with no latency: the clip opens at 8
        // with a media offset of -4, so its media origin is 12.
        const input = { recordPointBeat: 12, mediaOriginSeconds: 6, clipMediaOriginBeat: 12, timeline: flat120 };

        const pass1 = placeTakeOnClipMedia(take('pass-1', 'rec', 8, 16, 0), input);
        const pass2 = placeTakeOnClipMedia(take('pass-2', 'rec', 8, 16, 4), input);
        const pass3 = placeTakeOnClipMedia(take('pass-3', 'rec', 8, 16, 12), input);

        expect([pass1.startBeat, pass1.sourceOffsetBeats, pass1.passStartBeats]).toEqual([12, 0, 0]);
        expect([pass2.startBeat, pass2.sourceOffsetBeats, pass2.passStartBeats]).toEqual([8, 4, -4]);
        expect([pass3.startBeat, pass3.sourceOffsetBeats, pass3.passStartBeats]).toEqual([8, 12, -4]);
    });

    it('measures both terms in the clip’s offset unit across a tempo change', () => {
        // Loop [8,16), recorded from beat 12 at 60 BPM with 20 ms of latency,
        // the tempo having dropped from 120 at beat 10. The capture began at
        // 6.98 s; the clip opens at 8, entering its media at
        // (4 − 6.98) s × 120/60 = −5.96, so its media origin reads 13.96.
        const input = {
            recordPointBeat: 12,
            mediaOriginSeconds: 6.98,
            clipMediaOriginBeat: 13.96,
            timeline: slowingAt10,
        };

        const pass1 = placeTakeOnClipMedia(take('pass-1', 'rec', 8, 16, 0), input);
        const pass2 = placeTakeOnClipMedia(take('pass-2', 'rec', 8, 16, 4), input);

        // Pass 1 sounds from the record point, 0.02 s into the media at 60 BPM.
        expect(pass1.startBeat).toBe(12);
        expect(pass1.passStartBeats).toBeCloseTo(-1.96, 9);
        expect(pass1.sourceOffsetBeats).toBeCloseTo(0.02, 9);
        // Pass 2 sounds from the loop start, at 120 BPM, on what was captured
        // when the playhead wrapped: 4 s of 60 BPM after the record point.
        expect(pass2.startBeat).toBe(8);
        expect(pass2.passStartBeats).toBeCloseTo(-5.96, 9);
        expect(pass2.sourceOffsetBeats).toBeCloseTo(4.02 * 2, 9);
    });

    it('measures a later pass through whole loops of the tempo map', () => {
        // Loop [16,24) at 60 BPM, run up from 12 after the drop at 10: pass 3 is
        // the run-up, then two whole loops of 8 s, into the media.
        const placed = placeTakeOnClipMedia(take('pass-3', 'rec', 16, 24, 20), {
            recordPointBeat: 12,
            mediaOriginSeconds: 3.98,
            clipMediaOriginBeat: 9.98,
            timeline: slowingAt10,
        });

        expect(placed.sourceOffsetBeats).toBeCloseTo(4 + 16 + 3.02, 9);
        expect(placed.passStartBeats).toBeCloseTo(6.02, 9);
    });

    it('places no take that plays its clip’s own media on a capture with no lead', () => {
        const opening = take('take-1', 'rec', 1, 5);
        expect(
            placeTakeOnClipMedia(opening, {
                recordPointBeat: 1,
                mediaOriginSeconds: 0.5,
                clipMediaOriginBeat: 1,
                timeline: flat120,
            })
        ).toBe(opening);
    });
});

describe('placeRecordingTakes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('places only the takes of the recording clip', () => {
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
        placeRecordingTakes({ clipId: 'rec', recordPointBeat: 1, mediaOriginSeconds: 0.25, clipMediaOriginBeat: 0.5 });

        const written = mocks.set.mock.calls[0]![0].lanes[0]!.takes;
        expect(written.map((entry) => [entry.id, entry.sourceOffsetBeats, entry.passStartBeats])).toEqual([
            ['first', 0.5, 0.5],
            ['pass-1', 1.5, 1.5],
            ['other', 3, undefined],
        ]);
    });
});
