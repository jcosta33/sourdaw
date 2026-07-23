import { describe, it, expect, vi, beforeEach } from 'vitest';

type FixtureClip = { id: string; startBeat: number; endBeat: number; type?: string };

const { trackState, setTrackState, insertTime } = vi.hoisted(() => ({
    trackState: {
        value: {
            tracks: [] as Array<{ id: string; clips: FixtureClip[] }>,
        },
    },
    setTrackState: vi.fn(),
    insertTime: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: () => trackState.value,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState,
}));

vi.mock('../insertTime', () => ({
    insertTime,
}));

import { midiStore } from '#/modules/MIDI/stores';

import { duplicateTimeRange } from '../duplicateTimeRange';

describe('duplicateTimeRange', () => {
    it('duplicates MIDI notes into the new clip ids so duplicates are not silent (regression: ledger M-023)', () => {
        trackState.value = {
            tracks: [
                {
                    id: 'track-1',
                    clips: [{ id: 'midi-1', startBeat: 4, endBeat: 6, type: 'midi' }],
                },
            ],
        };
        midiStore.set({
            notesByClipId: {
                'midi-1': [{ id: 'n1', pitch: 60, startBeat: 1.5, duration: 0.5, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        duplicateTimeRange(4, 6);

        const written = setTrackState.mock.calls[0]?.[0] as {
            tracks: Array<{ clips: Array<{ id: string; type?: string; startBeat: number }> }>;
        };
        const duplicate = written.tracks[0]!.clips.find((clip) => clip.id !== 'midi-1');
        if (!duplicate) {
            throw new Error('Expected a duplicated clip');
        }
        expect(duplicate.startBeat).toBe(6);

        // Notes are clip-relative: the verbatim copy must land in the new id
        // at the same relative beat (1.5), i.e. playback at 6 + 1.5 = 7.5.
        const duplicatedNotes = midiStore.value?.notesByClipId[duplicate.id];
        expect(duplicatedNotes).toHaveLength(1);
        expect(duplicatedNotes![0]!.startBeat).toBe(1.5);
        expect(duplicatedNotes![0]!.pitch).toBe(60);
        expect(duplicatedNotes![0]!.id).not.toBe('n1');
    });

    beforeEach(() => {
        trackState.value = {
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'before', startBeat: 1, endBeat: 3 },
                        { id: 'inside', startBeat: 4, endBeat: 6 },
                        { id: 'after-inserted-copy', startBeat: 8, endBeat: 10 },
                    ],
                },
            ],
        };
        setTrackState.mockClear();
        insertTime.mockClear();
    });

    it('should export duplicateTimeRange', () => {
        expect(duplicateTimeRange).toBeDefined();
        const time = typeof duplicateTimeRange;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('should insert space and duplicate clips in the selected range', () => {
        duplicateTimeRange(4, 6);

        expect(insertTime).toHaveBeenCalledWith(6, 2);
        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'before', startBeat: 1, endBeat: 3 },
                        { id: 'inside', startBeat: 4, endBeat: 6 },
                        { id: 'after-inserted-copy', startBeat: 8, endBeat: 10 },
                        {
                            id: expect.stringMatching(/^clip-dup-/),
                            startBeat: 6,
                            endBeat: 8,
                        },
                    ],
                },
            ],
        });
    });
});
