import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    setTrackState: vi.fn<(typeof trackSetRepo)['setTrackState']>(),
    getNextClipId: vi.fn(() => 'new-clip-right'),
    snapToZeroCrossing: vi.fn<(typeof snapModule)['snapToZeroCrossing']>(),
    splitMidiNotesAtBeat: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../repositories/clipIdCounter', () => ({ getNextClipId: mocks.getNextClipId }));
vi.mock('#/modules/MIDI/useCases', () => ({ splitMidiNotesAtBeat: mocks.splitMidiNotesAtBeat }));
vi.mock('../../timelineInteractions/snapToZeroCrossing', () => ({ snapToZeroCrossing: mocks.snapToZeroCrossing }));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { type TrackState } from '../../../repositories/track/getTrackState';
import { splitClip } from '../splitClip';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as trackSetRepo from '../../../repositories/track/setTrackState';
import type * as snapModule from '../../timelineInteractions/snapToZeroCrossing';

function makeClip(id: string, start: number, end: number, type: Clip['type'] = 'audio'): Clip {
    return ClipDummy.create({ id, name: id, startBeat: start, endBeat: end, type, fadeInBeats: 0, fadeOutBeats: 0 });
}

function makeState(clips: Clip[]): TrackState {
    return { tracks: [TrackDummy.create({ id: 't1', clips })], selectedTrackId: 't1' };
}

function newTrackState(): TrackState {
    const newState = mocks.setTrackState.mock.calls[0]?.[0];
    if (!newState) {
        throw new Error('expected setTrackState to be called with the split state');
    }
    return newState;
}

describe('splitClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getNextClipId.mockReturnValue('new-clip-right');
        mocks.snapToZeroCrossing.mockImplementation((_clip, beat) => beat);
    });

    it('returns null when no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(splitClip('c1', 2)).toBeNull();
    });

    it('returns null when clip not found', () => {
        mocks.getTrackState.mockReturnValue(makeState([]));
        expect(splitClip('nonexistent', 2)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('returns null when split at clip start', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));
        expect(splitClip('c1', 0)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('returns null when split at clip end', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));
        expect(splitClip('c1', 4)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('splits clip at midpoint into a trimmed left clip and an offset right clip', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));

        const result = splitClip('c1', 2);
        expect(result).toBe('new-clip-right');
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);

        const clips = newTrackState().tracks[0]?.clips ?? [];
        expect(clips).toHaveLength(2);
        const left = clips.find((context) => context.name.includes('(L)'));
        const right = clips.find((context) => context.name.includes('(R)'));
        expect(left).toMatchObject({ id: 'c1', startBeat: 0, endBeat: 2, fadeOutBeats: 0 });
        expect(right).toMatchObject({
            id: 'new-clip-right',
            startBeat: 2,
            endBeat: 4,
            fadeInBeats: 0,
            audioOffsetBeats: 2,
        });
    });

    it('uses snapToZeroCrossing to adjust the split point of audio clips', () => {
        mocks.snapToZeroCrossing.mockReturnValue(2.5);
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'audio')]));

        splitClip('c1', 2);
        expect(mocks.snapToZeroCrossing).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), 2);

        const clips = newTrackState().tracks[0]?.clips ?? [];
        expect(clips.find((context) => context.id === 'c1')?.endBeat).toBe(2.5);
        expect(clips.find((context) => context.id === 'new-clip-right')?.startBeat).toBe(2.5);
    });

    it('does not call splitMidiNotesAtBeat for audio clips', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'audio')]));

        splitClip('c1', 2);
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('partitions midi notes across both clip ids for midi clips', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'midi')]));

        expect(splitClip('c1', 3)).toBe('new-clip-right');
        expect(mocks.splitMidiNotesAtBeat).toHaveBeenCalledWith({
            sourceClipId: 'c1',
            newClipId: 'new-clip-right',
            splitBeat: 3,
        });
    });

    it('returns null when snap pushes split outside clip', () => {
        mocks.snapToZeroCrossing.mockReturnValue(0);
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));

        expect(splitClip('c1', 2)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
