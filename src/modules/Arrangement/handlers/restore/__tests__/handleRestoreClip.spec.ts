import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/modules/Command/useCases';

import { createTrack, type Track } from '../../../models/Track';
import { type undoRippleDelete } from '../../../useCases/rippleDelete/undoRippleDelete';
import { type updateTrack } from '../../../useCases/updateTrack';
import { handleRestoreClip } from '../handleRestoreClip';

type RestoreClipAction = Extract<AppAction, { type: 'restoreClip' }>;

type RestoreMidiClipDataInput = {
    clipId: string;
    notesSnapshot: readonly unknown[] | null;
    controlChangeSnapshot: readonly unknown[] | null;
    pitchBendSnapshot: readonly unknown[] | null;
};

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn<typeof updateTrack>(),
    undoRippleDelete: vi.fn<typeof undoRippleDelete>(),
    restoreMidiClipData: vi.fn<(input: RestoreMidiClipDataInput) => void>(),
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../useCases/rippleDelete/undoRippleDelete', () => ({
    undoRippleDelete: mocks.undoRippleDelete,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    restoreMidiClipData: mocks.restoreMidiClipData,
}));

function createRestoreClipAction(overrides: Partial<RestoreClipAction['payload']> = {}): RestoreClipAction {
    return {
        type: 'restoreClip',
        payload: {
            clipId: 'c1',
            trackId: 't1',
            clipSnapshot: { id: 'c1', trackId: 't1', startBeat: 0, endBeat: 1 },
            ripplePlan: null,
            midiNotesSnapshot: null,
            midiCcSnapshot: null,
            midiPitchBendSnapshot: null,
            ...overrides,
        },
    };
}

describe('handleRestoreClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores the ripple plan before forwarding exact MIDI snapshots to the owner', () => {
        const midiNotesSnapshot = [{ id: 'note-1', pitch: 60 }] as const;
        const midiCcSnapshot = [{ id: 'cc-1', value: 64 }] as const;
        const midiPitchBendSnapshot = [{ id: 'pitch-1', value: 256 }] as const;
        const action = createRestoreClipAction({
            ripplePlan: {
                removedClips: [{ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 1 }],
                shiftedClips: [{ clipId: 'c2', origStartBeat: 1, origEndBeat: 2 }],
            },
            midiNotesSnapshot,
            midiCcSnapshot,
            midiPitchBendSnapshot,
        });

        void handleRestoreClip.execute(action);

        expect(mocks.undoRippleDelete).toHaveBeenCalledWith({
            trackId: 't1',
            removedClips: action.payload.ripplePlan?.removedClips,
            shiftedClips: action.payload.ripplePlan?.shiftedClips,
        });
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.restoreMidiClipData).toHaveBeenCalledTimes(1);
        expect(mocks.restoreMidiClipData).toHaveBeenCalledWith({
            clipId: 'c1',
            notesSnapshot: midiNotesSnapshot,
            controlChangeSnapshot: midiCcSnapshot,
            pitchBendSnapshot: midiPitchBendSnapshot,
        });

        const restoreInput = mocks.restoreMidiClipData.mock.calls[0]?.[0];
        if (!restoreInput) {
            throw new Error('Expected MIDI restore input');
        }

        expect(restoreInput.notesSnapshot).toBe(midiNotesSnapshot);
        expect(restoreInput.controlChangeSnapshot).toBe(midiCcSnapshot);
        expect(restoreInput.pitchBendSnapshot).toBe(midiPitchBendSnapshot);

        const rippleOrder = mocks.undoRippleDelete.mock.invocationCallOrder[0];
        const midiRestoreOrder = mocks.restoreMidiClipData.mock.invocationCallOrder[0];
        if (rippleOrder === undefined || midiRestoreOrder === undefined) {
            throw new Error('Expected ripple and MIDI restore calls');
        }

        expect(rippleOrder).toBeLessThan(midiRestoreOrder);
    });

    it('updates the track before forwarding all-null snapshots to the owner', () => {
        let updatedTrack: Track | undefined;
        mocks.updateTrack.mockImplementation((trackId, updater) => {
            expect(trackId).toBe('t1');
            updatedTrack = updater(createTrack({ id: 't1', name: 'Track 1', kind: 'midi' }));
        });
        const action = createRestoreClipAction();

        void handleRestoreClip.execute(action);

        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        expect(mocks.undoRippleDelete).not.toHaveBeenCalled();
        expect(updatedTrack?.clips).toEqual([action.payload.clipSnapshot]);
        expect(mocks.restoreMidiClipData).toHaveBeenCalledTimes(1);
        expect(mocks.restoreMidiClipData).toHaveBeenCalledWith({
            clipId: 'c1',
            notesSnapshot: null,
            controlChangeSnapshot: null,
            pitchBendSnapshot: null,
        });

        const updateOrder = mocks.updateTrack.mock.invocationCallOrder[0];
        const midiRestoreOrder = mocks.restoreMidiClipData.mock.invocationCallOrder[0];
        if (updateOrder === undefined || midiRestoreOrder === undefined) {
            throw new Error('Expected track and MIDI restore calls');
        }

        expect(updateOrder).toBeLessThan(midiRestoreOrder);
    });

    it('provides a description', () => {
        const desc = handleRestoreClip.describe(createRestoreClipAction());
        expect(desc.label).toBe('Restore clip');
    });

    it('is not undoable', () => {
        expect(handleRestoreClip.undoable).toBe(false);
    });
});
