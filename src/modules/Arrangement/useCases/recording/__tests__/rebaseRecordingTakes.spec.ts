import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rebaseTakeOntoMedia, type Take } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { rebaseRecordingTakes } from '../rebaseRecordingTakes';

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

function take(id: string, clipId: string, startBeat: number, sourceOffsetBeats?: number): Take {
    const result: Take = { id, clipId, name: id, startBeat, endBeat: startBeat + 4, selected: false };
    if (sourceOffsetBeats !== undefined) {
        result.sourceOffsetBeats = sourceOffsetBeats;
    }
    return result;
}

describe('rebaseTakeOntoMedia', () => {
    it('gives the take opened with the recording the whole shift as its offset', () => {
        expect(rebaseTakeOntoMedia(take('first', 'rec', 1), 1, 0.5).sourceOffsetBeats).toBe(0.5);
    });

    it('adds the shift to a pass that names its depth', () => {
        expect(rebaseTakeOntoMedia(take('pass', 'rec', 2, 5), 1, 0.5).sourceOffsetBeats).toBe(5.5);
    });

    it('starts a first pass that began before the record point where its media does', () => {
        const rebased = rebaseTakeOntoMedia({ ...take('pass-1', 'rec', 8, 0), endBeat: 16 }, 12, 0.5);
        expect([rebased.startBeat, rebased.sourceOffsetBeats, rebased.passStartBeats]).toEqual([12, 0.5, 0.5]);
    });

    it('leaves a first pass whose span does not contain the record point where it is', () => {
        const rebased = rebaseTakeOntoMedia(take('pass-1', 'rec', 0, 0), 9, 0);
        expect([rebased.startBeat, rebased.sourceOffsetBeats]).toEqual([0, 0]);
    });

    it('places each pass against the media origin rather than the timeline', () => {
        // Loop [2,6) recorded from beat 1 with 0.5 beat of latency: the media
        // begins at 0.5, so the loop start sounds 1.5 beats into it.
        expect(rebaseTakeOntoMedia(take('pass-2', 'rec', 2, 5), 1, 0.5).passStartBeats).toBe(1.5);
        // Loop [8,16) recorded from beat 12: pass 2 sounds 4 beats before its media.
        expect(rebaseTakeOntoMedia({ ...take('pass-2', 'rec', 8, 4), endBeat: 16 }, 12, 0).passStartBeats).toBe(-4);
    });

    it('places no take that plays its clip’s own media', () => {
        const unmoved = take('first', 'rec', 1);
        expect(rebaseTakeOntoMedia(unmoved, 1, 0)).toBe(unmoved);
    });

    it('is idempotent once applied', () => {
        const once = rebaseTakeOntoMedia({ ...take('pass-1', 'rec', 8, 0), endBeat: 16 }, 12, 0);
        expect([once.startBeat, once.passStartBeats]).toEqual([12, 0]);
        expect(rebaseTakeOntoMedia(once, 12, 0)).toBe(once);
        const pass = rebaseTakeOntoMedia(take('pass', 'rec', 2, 5), 1, 0);
        expect(rebaseTakeOntoMedia(pass, 1, 0)).toBe(pass);
    });
});

describe('rebaseRecordingTakes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rebases only the takes of the recording clip', () => {
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [take('first', 'rec', 1), take('pass-1', 'rec', 2, 1), take('other', 'old', 2, 3)],
                    activeCompRegions: [],
                },
            ],
        };

        rebaseRecordingTakes({ clipId: 'rec', provisionalStartBeat: 1, shiftBeats: 0.5 });

        const written = mocks.set.mock.calls[0]![0].lanes[0]!.takes;
        expect(written.map((entry) => [entry.id, entry.sourceOffsetBeats, entry.passStartBeats])).toEqual([
            ['first', 0.5, 0.5],
            ['pass-1', 1.5, 1.5],
            ['other', 3, undefined],
        ]);
    });
});
