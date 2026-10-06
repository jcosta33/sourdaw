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
        expect([rebased.startBeat, rebased.sourceOffsetBeats]).toEqual([12, 0.5]);
    });

    it('leaves a first pass whose span does not contain the record point where it is', () => {
        const rebased = rebaseTakeOntoMedia(take('pass-1', 'rec', 0, 0), 9, 0);
        expect([rebased.startBeat, rebased.sourceOffsetBeats]).toEqual([0, 0]);
    });

    it('leaves a take untouched when nothing moves', () => {
        const unmoved = take('first', 'rec', 1);
        expect(rebaseTakeOntoMedia(unmoved, 1, 0)).toBe(unmoved);
        const pass = take('pass', 'rec', 2, 5);
        expect(rebaseTakeOntoMedia(pass, 1, 0)).toBe(pass);
    });

    it('is idempotent for a zero shift', () => {
        const once = rebaseTakeOntoMedia({ ...take('pass-1', 'rec', 8, 0), endBeat: 16 }, 12, 0);
        expect(once.startBeat).toBe(12);
        expect(rebaseTakeOntoMedia(once, 12, 0)).toBe(once);
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
        expect(written.map((entry) => [entry.id, entry.sourceOffsetBeats])).toEqual([
            ['first', 0.5],
            ['pass-1', 1.5],
            ['other', 3],
        ]);
    });
});
