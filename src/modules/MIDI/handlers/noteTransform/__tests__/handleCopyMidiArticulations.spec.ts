import { describe, expect, it } from 'vitest';

import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { handleCopyMidiArticulations } from '../handleCopyMidiArticulations';
import { handleRestoreMidiClipNotes } from '../handleRestoreMidiClipNotes';

function note(id: string, articulation?: string): MidiClipNoteSnapshot {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 1,
        velocity: 96,
        ...(articulation ? { articulation } : {}),
    };
}

function requireRestoreAction(
    action: AppAction | null | undefined
): Extract<AppAction, { type: 'restoreMidiClipNotes' }> {
    if (action?.type !== 'restoreMidiClipNotes') {
        throw new Error('Expected restoreMidiClipNotes action');
    }
    return action;
}

describe('handleCopyMidiArticulations', () => {
    it('carries the immutable source and eligibility snapshot symmetrically into undo and redo', () => {
        const expectedSourceNotes = [note('source-note', 'staccato')];
        const expectedTargetNotes = [note('target-note', 'legato')];
        const action: Extract<AppAction, { type: 'copyMidiArticulations' }> = {
            type: 'copyMidiArticulations',
            payload: {
                trackId: 'track-1',
                sourceClipId: 'chorus-one',
                targetClipId: 'chorus-two',
                notePairs: [{ sourceNoteId: 'source-note', targetNoteId: 'target-note' }],
                expectedSourceNotes,
                expectedTargetNotes,
                expectedTrackFrozen: false,
                expectedSourceClipLocked: false,
                expectedTargetClipLocked: false,
            },
        };

        const description = handleCopyMidiArticulations.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);
        const redo = requireRestoreAction(description.redoAction);
        const expectedReplayGuard = {
            trackId: 'track-1',
            sourceClipId: 'chorus-one',
            expectedSourceNotes,
            expectedTrackFrozen: false,
            expectedSourceClipLocked: false,
            expectedTargetClipLocked: false,
        };

        expect(inverse.payload.articulationReplayGuard).toEqual(expectedReplayGuard);
        expect(redo.payload.articulationReplayGuard).toEqual(expectedReplayGuard);
        expect(inverse.payload.expectedNotes[0]?.articulation).toBe('staccato');
        expect(redo.payload.notes[0]?.articulation).toBe('staccato');
        expect(handleRestoreMidiClipNotes.requiresAbortCompensation).toBe(false);
    });

    it('preserves explicit articulation absence in replay guards', () => {
        const expectedSourceNotes = [note('source-note')];
        const action: Extract<AppAction, { type: 'copyMidiArticulations' }> = {
            type: 'copyMidiArticulations',
            payload: {
                trackId: 'track-1',
                sourceClipId: 'chorus-one',
                targetClipId: 'chorus-two',
                notePairs: [{ sourceNoteId: 'source-note', targetNoteId: 'target-note' }],
                expectedSourceNotes,
                expectedTargetNotes: [note('target-note', 'tenuto')],
                expectedTrackFrozen: false,
                expectedSourceClipLocked: false,
                expectedTargetClipLocked: false,
            },
        };

        const inverse = requireRestoreAction(handleCopyMidiArticulations.describe(action).inverseAction);

        expect(inverse.payload.articulationReplayGuard?.expectedSourceNotes).toEqual(expectedSourceNotes);
        expect(inverse.payload.expectedNotes[0]).not.toHaveProperty('articulation');
    });
});
