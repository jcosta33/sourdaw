import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<(typeof trackStateRepo)['getTrackState']>(),
    updateClip: vi.fn<(typeof updateClipRepo)['updateClip']>(),
    splitClip: vi.fn<(typeof splitClipModule)['splitClip']>(),
    removeClip: vi.fn(),
    pushUndoEntry: vi.fn<(label: string, undoFn: () => void, redoFn: () => unknown) => void>(),
    getMidiStoreState: vi.fn(),
    restoreMidiClipData: vi.fn(),
    notifyUser: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn<(typeof resolverModule)['resolveEligibleClipWriteTarget']>(),
    readClipSatelliteEntry: vi.fn<(typeof satelliteModule)['readClipSatelliteEntry']>(),
    writeClipSatelliteEntry: vi.fn<(typeof satelliteModule)['writeClipSatelliteEntry']>(),
    redoNotApplied: Symbol('redo-not-applied'),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/updateClip', () => ({ updateClip: mocks.updateClip }));
vi.mock('../splitClip', () => ({ splitClip: mocks.splitClip }));
vi.mock('../../clip/removeClip', () => ({ removeClip: mocks.removeClip }));
vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
    REDO_NOT_APPLIED: mocks.redoNotApplied,
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    getMidiStoreState: mocks.getMidiStoreState,
    restoreMidiClipData: mocks.restoreMidiClipData,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));
vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
    writeClipSatelliteEntry: mocks.writeClipSatelliteEntry,
}));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { splitClipWithUndo } from '../splitClipWithUndo';

import type * as trackStateRepo from '../../../repositories/track/getTrackState';
import type * as updateClipRepo from '../../../repositories/track/updateClip';
import type * as satelliteModule from '../../../stores/clipSatelliteState';
import type * as resolverModule from '../../../stores/resolveEligibleClipWriteTarget';
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
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getMidiStoreState.mockReturnValue(null);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1', clipId: 'c1' });
        mocks.readClipSatelliteEntry.mockImplementation((clipId) => ({
            clipId,
            gainEnvelope: null,
            warpState: null,
        }));
    });

    it('does nothing when the clip does not exist', () => {
        setState([]);
        splitClipWithUndo('missing', 2);
        expect(mocks.splitClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rejects an ineligible owner before MIDI snapshots or split work', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 8 })]);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        splitClipWithUndo('c1', 4);

        expect(mocks.getMidiStoreState).not.toHaveBeenCalled();
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

    it('restores frozen source and right MIDI snapshots across undo and redo', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 8, type: 'midi' })]);
        const sourceNotes = [{ id: 'source-note' }];
        const sourceCc = [{ id: 'source-cc' }];
        const sourcePitchBend = [{ id: 'source-pitch' }];
        const rightNotes = [{ id: 'right-note' }];
        const rightCc = [{ id: 'right-cc' }];
        const rightPitchBend = [{ id: 'right-pitch' }];
        mocks.getMidiStoreState
            .mockReturnValueOnce({
                notesByClipId: { c1: sourceNotes },
                ccByClipId: { c1: sourceCc },
                pitchBendByClipId: { c1: sourcePitchBend },
            })
            .mockReturnValueOnce({
                notesByClipId: { 'right-1': rightNotes },
                ccByClipId: { 'right-1': rightCc },
                pitchBendByClipId: { 'right-1': rightPitchBend },
            });
        mocks.splitClip.mockReturnValue('right-1');

        splitClipWithUndo('c1', 4);
        const entry = capturedUndoEntry();
        entry.undoFn();
        entry.redoFn();

        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(1, {
            clipId: 'c1',
            notesSnapshot: sourceNotes,
            controlChangeSnapshot: sourceCc,
            pitchBendSnapshot: sourcePitchBend,
        });
        expect(mocks.restoreMidiClipData).toHaveBeenNthCalledWith(2, {
            clipId: 'right-1',
            notesSnapshot: rightNotes,
            controlChangeSnapshot: rightCc,
            pitchBendSnapshot: rightPitchBend,
        });
    });

    it('reports REDO_NOT_APPLIED without restoring MIDI when the deterministic destination is occupied', () => {
        setState([ClipDummy.create({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 8 })]);
        mocks.splitClip.mockReturnValueOnce('right-1').mockReturnValueOnce(null);

        splitClipWithUndo('c1', 4);
        const result = capturedUndoEntry().redoFn();

        expect(mocks.splitClip).toHaveBeenLastCalledWith('c1', 4, 'right-1');
        expect(result).toBe(mocks.redoNotApplied);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Failed to redo split clip - the clip no longer spans the split beat',
            'error'
        );
        expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
    });

    it('restores the frozen source satellites on undo and the repartitioned ones on redo', () => {
        setState([ClipDummy.create({ id: 'c1', startBeat: 0, endBeat: 8 })]);
        const sourceBefore = {
            clipId: 'c1',
            gainEnvelope: {
                clipId: 'c1',
                enabled: true,
                points: [{ id: 'p0', beatOffset: 0, gainDb: -3 }],
            },
            warpState: null,
        };
        const leftAfter = {
            clipId: 'c1',
            gainEnvelope: {
                clipId: 'c1',
                enabled: true,
                points: [
                    { id: 'p0', beatOffset: 0, gainDb: -3 },
                    { id: 'gep-split-right-1-left', beatOffset: 4, gainDb: -3 },
                ],
            },
            warpState: null,
        };
        const rightAfter = {
            clipId: 'right-1',
            gainEnvelope: {
                clipId: 'right-1',
                enabled: true,
                points: [{ id: 'gep-split-right-1-right', beatOffset: 0, gainDb: -3 }],
            },
            warpState: null,
        };
        mocks.readClipSatelliteEntry
            .mockReturnValueOnce(sourceBefore)
            .mockReturnValueOnce(leftAfter)
            .mockReturnValueOnce(rightAfter);
        mocks.splitClip.mockReturnValue('right-1');

        splitClipWithUndo('c1', 4);
        const entry = capturedUndoEntry();
        entry.undoFn();

        expect(mocks.writeClipSatelliteEntry).toHaveBeenNthCalledWith(1, sourceBefore);
        expect(mocks.writeClipSatelliteEntry).toHaveBeenNthCalledWith(2, {
            clipId: 'right-1',
            gainEnvelope: null,
            warpState: null,
        });

        entry.redoFn();

        expect(mocks.writeClipSatelliteEntry).toHaveBeenNthCalledWith(3, leftAfter);
        expect(mocks.writeClipSatelliteEntry).toHaveBeenNthCalledWith(4, rightAfter);
    });
});
