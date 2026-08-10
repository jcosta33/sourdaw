import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { copyMidiArticulationsToNotes } from '../copyMidiArticulationsToNotes';

function note(id: string, pitch: number, articulation?: string): MidiNote {
    return {
        id,
        pitch,
        startBeat: 0,
        duration: 1,
        velocity: 80,
        ...(articulation ? { articulation } : {}),
    };
}

describe('copyMidiArticulationsToNotes', () => {
    it('copies and clears only articulation while preserving target note state', () => {
        const source = [note('source-low', 48, 'staccato'), note('source-high', 60)];
        const target = [note('target-low', 50, 'legato'), note('target-high', 67, 'accent')];

        expect(
            copyMidiArticulationsToNotes({
                sourceNotes: source,
                targetNotes: target,
                notePairs: [
                    { sourceNoteId: 'source-low', targetNoteId: 'target-low' },
                    { sourceNoteId: 'source-high', targetNoteId: 'target-high' },
                ],
            })
        ).toEqual([note('target-low', 50, 'staccato'), note('target-high', 67)]);
    });

    it('rejects duplicate source or target mappings instead of silently omitting a voice', () => {
        const source = [note('source-low', 48, 'staccato'), note('source-high', 60, 'accent')];
        const target = [note('target-low', 50), note('target-high', 67)];

        expect(
            copyMidiArticulationsToNotes({
                sourceNotes: source,
                targetNotes: target,
                notePairs: [
                    { sourceNoteId: 'source-low', targetNoteId: 'target-low' },
                    { sourceNoteId: 'source-low', targetNoteId: 'target-high' },
                ],
            })
        ).toBeNull();
        expect(
            copyMidiArticulationsToNotes({
                sourceNotes: source,
                targetNotes: target,
                notePairs: [
                    { sourceNoteId: 'source-low', targetNoteId: 'target-low' },
                    { sourceNoteId: 'source-high', targetNoteId: 'target-low' },
                ],
            })
        ).toBeNull();
    });
});
