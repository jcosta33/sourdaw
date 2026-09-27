import { describe, expect, it } from 'vitest';

import { isValidMidiNoteExpression } from '../../../models/MidiNote';
import { projectDrumPreviewCandidateNotes } from '../projectDrumPreviewCandidateNotes';

const sourceNotes = [
    { id: 'n-1', pitch: 38, startBeat: 0.5, duration: 0.25, velocity: 100, channel: 9 },
    { id: 'n-2', pitch: 38, startBeat: 1.5, duration: 0.25, velocity: 90, channel: 9 },
    { id: 'n-3', pitch: 38, startBeat: 2.5, duration: 0.25, velocity: 80, channel: 9 },
] as const;

describe('projectDrumPreviewCandidateNotes', () => {
    it('projects three deterministic, distinct recipes without mutating the source notes', () => {
        const original = structuredClone(sourceNotes);
        const results = (['ghost-note-pocket', 'half-time-space', 'syncopated-hats'] as const).map((recipe) =>
            projectDrumPreviewCandidateNotes({
                branchId: '00000000-0000-4000-8000-000000000001',
                endBeat: 4,
                notes: sourceNotes,
                recipe,
                role: 'snare',
                startBeat: 0,
            })
        );

        expect(sourceNotes).toEqual(original);
        expect(results.every((notes) => notes !== null)).toBe(true);
        expect(new Set(results.map((notes) => JSON.stringify(notes)))).toHaveProperty('size', 3);
        expect(results[0]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'preview-00000000-0000-4000-8000-000000000001-ghost-n-1' }),
            ])
        );
        expect(results[1]?.map(({ id }) => id)).toEqual(['n-1', 'n-3']);
        expect(results[2]?.find(({ id }) => id === 'n-2')?.startBeat).toBe(1.75);
    });

    it('keeps every projected note inside the declared section and preserves non-programming fields', () => {
        const notes = projectDrumPreviewCandidateNotes({
            branchId: '00000000-0000-4000-8000-000000000002',
            endBeat: 4,
            notes: [
                ...sourceNotes,
                { id: 'n-edge', pitch: 38, startBeat: 3.75, duration: 0.25, velocity: 70, channel: 9 },
            ],
            recipe: 'syncopated-hats',
            role: 'hi-hat',
            startBeat: 0,
        });

        expect(notes?.every((note) => note.startBeat >= 0 && note.startBeat + note.duration <= 4)).toBe(true);
        expect(notes?.filter(({ id }) => id.startsWith('n-'))).toEqual(
            expect.arrayContaining([
                ...sourceNotes,
                { id: 'n-edge', pitch: 38, startBeat: 3.75, duration: 0.25, velocity: 70, channel: 9 },
            ])
        );
        expect(notes?.some(({ id }) => id.endsWith('n-edge') && id.startsWith('preview-'))).toBe(false);
    });

    it.each([
        ['ghost-note-pocket' as const, 'snare' as const, '00000000-0000-4000-8000-000000000004'],
        ['syncopated-hats' as const, 'hi-hat' as const, '00000000-0000-4000-8000-000000000005'],
    ])('%s keeps a shortened copy of a curved note’s expression inside its own span', (recipe, role, branchId) => {
        const curvedNote = {
            id: 'n-curved',
            pitch: 38,
            startBeat: 1,
            duration: 0.5,
            velocity: 100,
            channel: 9,
            expression: {
                pressure: [
                    { offsetBeats: 0.05, value: 60 },
                    { offsetBeats: 0.25, value: 90 },
                ],
            },
        };
        const other = { id: 'n-other', pitch: 38, startBeat: 3, duration: 0.5, velocity: 90, channel: 9 };

        const results = projectDrumPreviewCandidateNotes({
            branchId,
            endBeat: 4,
            notes: [curvedNote, other],
            recipe,
            role,
            startBeat: 0,
        });

        const copy = results?.find((note) => note.id.endsWith('-n-curved') && note.id.startsWith('preview-'));
        expect(copy?.expression).toEqual({ pressure: [{ offsetBeats: 0.05, value: 60 }] });
        expect(isValidMidiNoteExpression(copy?.expression, copy!.duration)).toBe(true);
    });

    it.each([
        ['duplicate note ids', [sourceNotes[0], sourceNotes[0]], 0, 4],
        ['an out-of-section note', sourceNotes, 1, 4],
        ['fewer than two notes', [sourceNotes[0]], 0, 4],
    ])('rejects %s', (_case, notes, startBeat, endBeat) => {
        expect(
            projectDrumPreviewCandidateNotes({
                branchId: '00000000-0000-4000-8000-000000000003',
                endBeat,
                notes,
                recipe: 'ghost-note-pocket',
                role: 'snare',
                startBeat,
            })
        ).toBeNull();
    });
});
