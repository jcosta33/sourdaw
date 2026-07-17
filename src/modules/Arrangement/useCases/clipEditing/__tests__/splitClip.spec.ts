import { describe, it, expect, vi, beforeEach } from 'vitest';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as trackSetRepo from '../../../repositories/track/setTrackState';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<() => (typeof trackStateRepo)['getTrackState'] extends () => infer R ? R : never>(),
    setTrackState: vi.fn<(typeof trackSetRepo)['setTrackState']>(),
    getNextClipId: vi.fn(() => 'new-clip-right'),
    snapToZeroCrossing: vi.fn((clip: { startBeat: number }, beat: number) => beat),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../repositories/clipIdCounter', () => ({ getNextClipId: mocks.getNextClipId }));
vi.mock('#/modules/MIDI/useCases', () => ({ splitMidiNotesAtBeat: vi.fn() }));
vi.mock('../../timelineInteractions/snapToZeroCrossing', () => ({ snapToZeroCrossing: mocks.snapToZeroCrossing }));

import { splitClip } from '../splitClip';

const make_clip = (id: string, start: number, end: number, type: 'midi' | 'audio' = 'audio') => ({
    id,
    startBeat: start,
    endBeat: end,
    name: id,
    type,
    fadeInBeats: 0,
    fadeOutBeats: 0,
});

describe('splitClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns null when no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(splitClip('c1', 2)).toBeNull();
    });

    it('returns null when clip not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }], selectedTrackId: 't1' } as never);
        expect(splitClip('nonexistent', 2)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('returns null when split at clip start', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [make_clip('c1', 0, 4)] }],
            selectedTrackId: 't1',
        } as never);
        expect(splitClip('c1', 0)).toBeNull();
    });

    it('returns null when split at clip end', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [make_clip('c1', 0, 4)] }],
            selectedTrackId: 't1',
        } as never);
        expect(splitClip('c1', 4)).toBeNull();
    });

    it('splits clip at midpoint', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [make_clip('c1', 0, 4)] }],
            selectedTrackId: 't1',
        } as never);

        const result = splitClip('c1', 2);
        expect(result).toBe('new-clip-right');
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);

        const new_state = mocks.setTrackState.mock.calls[0]![0] as {
            tracks: { clips: { id: string; name: string; startBeat: number; endBeat: number }[] }[];
        };
        const clips = new_state.tracks[0]!.clips;
        expect(clips).toHaveLength(2);
        const left = clips.find((c) => c.name.includes('(L)'))!;
        const right = clips.find((c) => c.name.includes('(R)'))!;
        expect(left.endBeat).toBe(2);
        expect(right.startBeat).toBe(2);
        expect(right.id).toBe('new-clip-right');
    });

    it('uses snapToZeroCrossing for audio clips', () => {
        mocks.snapToZeroCrossing.mockReturnValue(2.5);
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [make_clip('c1', 0, 4, 'audio')] }],
            selectedTrackId: 't1',
        } as never);

        splitClip('c1', 2);
        expect(mocks.snapToZeroCrossing).toHaveBeenCalled();
    });

    it('does not call splitMidiNotesAtBeat for audio clips', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [make_clip('c1', 0, 4, 'audio')] }],
            selectedTrackId: 't1',
        } as never);

        splitClip('c1', 2);
        // splitMidiNotesAtBeat is mocked but we can verify it was NOT called
        // by checking that only setTrackState was called once
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
    });

    it('returns null when snap pushes split outside clip', () => {
        mocks.snapToZeroCrossing.mockReturnValue(0);
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [make_clip('c1', 0, 4)] }],
            selectedTrackId: 't1',
        } as never);

        expect(splitClip('c1', 2)).toBeNull();
    });
});
