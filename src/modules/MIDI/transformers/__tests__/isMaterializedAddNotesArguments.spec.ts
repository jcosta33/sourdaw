import { describe, expect, it } from 'vitest';

import { isMaterializedAddNotesArguments } from '../isMaterializedAddNotesArguments';

type CanonicalNote = {
    duration: number;
    id: string;
    pitch: number;
    probability: number;
    startBeat: number;
    velocity: number;
};

function canonicalNote(overrides: Partial<CanonicalNote> = {}): CanonicalNote {
    return { duration: 1, id: 'note-1', pitch: 60, probability: 100, startBeat: 0, velocity: 100, ...overrides };
}

function canonicalArguments(notes: unknown[] = [canonicalNote()]) {
    return { clipId: 'clip-1', notes };
}

describe('isMaterializedAddNotesArguments', () => {
    it('accepts the canonical shape the addNotes handler materializes', () => {
        expect(isMaterializedAddNotesArguments(canonicalArguments())).toBe(true);
        expect(
            isMaterializedAddNotesArguments(
                canonicalArguments([canonicalNote(), canonicalNote({ id: 'note-2', startBeat: 1 })])
            )
        ).toBe(true);
    });

    it('rejects an unknown key on the arguments record', () => {
        // The canonical arguments are the whole contract an envelope may carry, so a field the
        // handler never writes is a stale or invented one and must not reach a MIDI clip.
        expect(isMaterializedAddNotesArguments({ ...canonicalArguments(), trackId: 'track-1' })).toBe(false);
    });

    it('rejects an unknown key on a note', () => {
        expect(isMaterializedAddNotesArguments(canonicalArguments([{ ...canonicalNote(), channel: 0 }]))).toBe(false);
    });

    it.each([
        ['clipId', { notes: [canonicalNote()] }],
        ['notes', { clipId: 'clip-1' }],
    ])('rejects arguments missing %s', (_key, value) => {
        expect(isMaterializedAddNotesArguments(value)).toBe(false);
    });

    it.each(['duration', 'id', 'pitch', 'probability', 'startBeat', 'velocity'])('rejects a note missing %s', (key) => {
        const note: Record<string, unknown> = { ...canonicalNote() };
        delete note[key];

        expect(isMaterializedAddNotesArguments(canonicalArguments([note]))).toBe(false);
    });

    it.each([0, 50, 99.9, 101])('rejects a note whose probability is %s rather than canonical 100', (probability) => {
        expect(isMaterializedAddNotesArguments(canonicalArguments([canonicalNote({ probability })]))).toBe(false);
    });

    it('rejects an empty note list', () => {
        expect(isMaterializedAddNotesArguments(canonicalArguments([]))).toBe(false);
    });

    it.each([
        ['null', null],
        ['an array', [canonicalNote()]],
        ['a string', 'clip-1'],
        ['undefined', undefined],
    ])('rejects %s in place of an arguments record', (_description, value) => {
        expect(isMaterializedAddNotesArguments(value)).toBe(false);
    });

    it('rejects duplicate note ids', () => {
        expect(isMaterializedAddNotesArguments(canonicalArguments([canonicalNote(), canonicalNote()]))).toBe(false);
    });
});
