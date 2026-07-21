import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    updateClip: vi.fn<(typeof updateClipRepo)['updateClip']>(),
    splitClip: vi.fn<(typeof splitClipModule)['splitClip']>(),
    removeClip: vi.fn(),
    pushUndoEntry: vi.fn<(label: string, undoFn: () => void, redoFn: () => unknown) => void>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/updateClip', () => ({ updateClip: mocks.updateClip }));
vi.mock('../splitClip', () => ({ splitClip: mocks.splitClip }));
vi.mock('../../clip/removeClip', () => ({ removeClip: mocks.removeClip }));
vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: mocks.pushUndoEntry }));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { splitClipWithUndo } from '../splitClipWithUndo';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as updateClipRepo from '../../../repositories/track/updateClip';
import type * as splitClipModule from '../splitClip';

function setState(clips: Clip[]): void {
    mocks.getTrackState.mockReturnValue({
        tracks: [TrackDummy.create({ id: 't1', clips })],
        selectedTrackId: 't1',
    });
}

function capturedUndoEntry(): { label: string; undoFn: () => void; redoFn: () => unknown } {
    const call = mocks.pushUndoEntry.mock.calls[0];
    if (!call) {
        throw new Error('expected pushUndoEntry to be called');
    }
    return { label: call[0], undoFn: call[1], redoFn: call[2] };
}

describe('splitClipWithUndo', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does nothing when the clip does not exist', () => {
        setState([]);
        splitClipWithUndo('missing', 2);
        expect(mocks.splitClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('does not push an undo entry when the split is rejected', () => {
        setState([ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 8 })]);
        mocks.splitClip.mockReturnValue(null);

        splitClipWithUndo('c1', 0);

        expect(mocks.splitClip).toHaveBeenCalledWith('c1', 0);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('pushes a Split clip undo entry after a successful split', () => {
        setState([ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 8 })]);
        mocks.splitClip.mockReturnValue('right-1');

        splitClipWithUndo('c1', 4);

        expect(mocks.splitClip).toHaveBeenCalledWith('c1', 4);
        expect(capturedUndoEntry().label).toBe('Split clip');
    });

    it('undo removes the right clip and restores the left clip fields frozen before the split', () => {
        setState([ClipDummy.create({ id: 'c1', name: 'Groove', startBeat: 0, endBeat: 8, fadeOutBeats: 0.5 })]);
        mocks.splitClip.mockReturnValue('right-1');

        splitClipWithUndo('c1', 4);
        capturedUndoEntry().undoFn();

        expect(mocks.removeClip).toHaveBeenCalledWith('right-1');
        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));

        const updater = mocks.updateClip.mock.calls[0]?.[1];
        if (!updater) {
            throw new Error('expected updateClip to receive an updater');
        }
        const leftAfterSplit = ClipDummy.create({
            id: 'c1',
            name: 'Groove (L)',
            startBeat: 0,
            endBeat: 4,
            fadeOutBeats: 0,
        });
        expect(updater(leftAfterSplit)).toMatchObject({ name: 'Groove', endBeat: 8, fadeOutBeats: 0.5 });
    });

    it('redo replays the same split reusing the original right clip id', () => {
        setState([ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 8 })]);
        mocks.splitClip.mockReturnValue('right-1');

        splitClipWithUndo('c1', 4);
        mocks.splitClip.mockClear();

        capturedUndoEntry().redoFn();
        expect(mocks.splitClip).toHaveBeenCalledWith('c1', 4, 'right-1');
    });
});
