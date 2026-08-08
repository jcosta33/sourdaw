import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    setTrackState: vi.fn<(typeof trackSetRepo)['setTrackState']>(),
    getNextClipId: vi.fn(() => 'new-clip-right'),
    snapToZeroCrossing: vi.fn<(typeof snapModule)['snapToZeroCrossing']>(),
    prepareMidiClipSplit: vi.fn(),
    splitMidiNotesAtBeat: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../repositories/clipIdCounter', () => ({ getNextClipId: mocks.getNextClipId }));
vi.mock('#/modules/MIDI/useCases', () => ({
    prepareMidiClipSplit: mocks.prepareMidiClipSplit,
    splitMidiNotesAtBeat: mocks.splitMidiNotesAtBeat,
}));
vi.mock('../../timelineInteractions/snapToZeroCrossing', () => ({ snapToZeroCrossing: mocks.snapToZeroCrossing }));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { type TrackState } from '../../../repositories/track/getTrackState';
import { splitClip } from '../splitClip';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as trackSetRepo from '../../../repositories/track/setTrackState';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';
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
        mocks.prepareMidiClipSplit.mockImplementation(() => {
            const emptyMidi = {
                notes: { present: false, value: [] },
                controlChanges: { present: false, value: [] },
                pitchBends: { present: false, value: [] },
            };
            return {
                targetNoteIds: [],
                previousSource: emptyMidi,
                previousRight: emptyMidi,
                nextSource: emptyMidi,
                nextRight: emptyMidi,
            };
        });
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'c1' });
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

    it('rejects an ineligible owner before snapping, allocating, or writing', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        expect(splitClip('c1', 2)).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('rejects a non-finite split beat before snapping or allocating', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));

        expect(splitClip('c1', Number.NaN)).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('uses a preflight-resolved audio beat without resnapping against changed transport state', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 8)]));

        expect(splitClip('c1', 4, 'right-clip', [], 4.125)).toBe('right-clip');

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(newTrackState().tracks[0]!.clips).toMatchObject([
            { id: 'c1', endBeat: 4.125 },
            { id: 'right-clip', startBeat: 4.125 },
        ]);
    });

    it('rejects an empty explicit destination id before snapping or writing', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'midi')]));

        expect(splitClip('c1', 2, '')).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('rejects the source id as an explicit destination before snapping or writing', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'midi')]));

        expect(splitClip('c1', 2, 'c1')).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('rejects an explicit destination id already used on another track', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                TrackDummy.create({ id: 't1', clips: [makeClip('c1', 0, 4, 'midi')] }),
                TrackDummy.create({ id: 't2', clips: [ClipDummy.create({ id: 'occupied', trackId: 't2' })] }),
            ],
            selectedTrackId: 't1',
        });

        expect(splitClip('c1', 2, 'occupied')).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('rejects an explicit destination id stored in an inactive alternative', () => {
        const track = TrackDummy.create({
            id: 't1',
            activeAlternativeId: 'active',
            clips: [makeClip('c1', 0, 4, 'midi')],
            alternatives: [
                { id: 'active', name: 'Active', clips: [] },
                {
                    id: 'inactive',
                    name: 'Inactive',
                    clips: [ClipDummy.create({ id: 'captured-right', trackId: 't1', type: 'midi' })],
                },
            ],
        });
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: 't1' });

        expect(splitClip('c1', 2, 'captured-right')).toBeNull();

        expect(mocks.snapToZeroCrossing).not.toHaveBeenCalled();
        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.splitMidiNotesAtBeat).not.toHaveBeenCalled();
    });

    it('reuses a free explicit destination id without allocating another id', () => {
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4, 'midi')]));

        expect(splitClip('c1', 2, 'captured-right')).toBe('captured-right');

        expect(mocks.getNextClipId).not.toHaveBeenCalled();
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        expect(mocks.splitMidiNotesAtBeat).toHaveBeenCalledWith({
            sourceClipId: 'c1',
            newClipId: 'captured-right',
            splitBeat: 2,
            targetNoteIds: [],
        });
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
            targetNoteIds: [],
        });
    });

    it('returns null when snap pushes split outside clip', () => {
        mocks.snapToZeroCrossing.mockReturnValue(0);
        mocks.getTrackState.mockReturnValue(makeState([makeClip('c1', 0, 4)]));

        expect(splitClip('c1', 2)).toBeNull();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('leaves unrelated tracks untouched while splitting the owner track', () => {
        const otherClip = makeClip('other', 10, 14);
        mocks.getTrackState.mockReturnValue({
            tracks: [
                TrackDummy.create({ id: 't1', clips: [makeClip('c1', 0, 4)] }),
                TrackDummy.create({ id: 't2', clips: [otherClip] }),
            ],
            selectedTrackId: 't1',
        });

        expect(splitClip('c1', 2)).toBe('new-clip-right');

        const tracks = newTrackState().tracks;
        // The non-owner track is returned verbatim (same clip list, no split).
        const untouched = tracks.find((track) => track.id === 't2');
        expect(untouched?.clips).toEqual([otherClip]);
        expect(untouched?.clips).toHaveLength(1);
    });
});
