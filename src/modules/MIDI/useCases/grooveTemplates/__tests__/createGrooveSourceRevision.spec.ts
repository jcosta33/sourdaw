import { describe, it, expect } from 'vitest';

import { createGrooveSourceRevision } from '../createGrooveSourceRevision';

function note(id: string, startBeat: number, velocity: number) {
    return { id, startBeat, velocity };
}

describe('createGrooveSourceRevision', () => {
    it('produces identical revisions for the same notes in the same order', () => {
        const notes = [note('a', 0, 100), note('b', 1, 80)];
        expect(createGrooveSourceRevision(notes)).toBe(createGrooveSourceRevision(notes));
    });

    it('produces identical revisions for the same notes in DIFFERENT input order', () => {
        const orderA = [note('a', 0, 100), note('b', 1, 80)];
        const orderB = [note('b', 1, 80), note('a', 0, 100)];
        expect(createGrooveSourceRevision(orderA)).toBe(createGrooveSourceRevision(orderB));
    });

    it('sorts by startBeat ascending (not just consistently)', () => {
        const reversed = [note('b', 2, 50), note('a', 0, 50)];
        const parsed = JSON.parse(createGrooveSourceRevision(reversed)) as Array<{ id: string }>;
        // The lower-beat note ('a', beat 0) comes first after sorting.
        expect(parsed[0]!.id).toBe('a');
        expect(parsed[1]!.id).toBe('b');
    });

    it('breaks ties by velocity ascending when startBeats are equal', () => {
        const highFirst = [note('b', 1, 90), note('a', 1, 50)];
        const parsed = JSON.parse(createGrooveSourceRevision(highFirst)) as Array<{ id: string }>;
        // Lower velocity (50) comes first.
        expect(parsed[0]!.id).toBe('a');
        expect(parsed[1]!.id).toBe('b');
    });

    it('breaks ties by id ascending when startBeat and velocity are equal', () => {
        const bFirst = [note('b', 1, 50), note('a', 1, 50)];
        const parsed = JSON.parse(createGrooveSourceRevision(bFirst)) as Array<{ id: string }>;
        // 'a' < 'b' lexicographically.
        expect(parsed[0]!.id).toBe('a');
        expect(parsed[1]!.id).toBe('b');
    });

    it('produces different revisions when note content differs', () => {
        const base = [note('a', 0, 100)];
        const changed = [note('a', 0, 99)];
        expect(createGrooveSourceRevision(base)).not.toBe(createGrooveSourceRevision(changed));
    });

    it('produces different revisions when a note is added', () => {
        const one = [note('a', 0, 100)];
        const two = [note('a', 0, 100), note('b', 1, 100)];
        expect(createGrooveSourceRevision(one)).not.toBe(createGrooveSourceRevision(two));
    });

    it('returns a JSON array string', () => {
        const revision = createGrooveSourceRevision([note('a', 0, 100)]);
        const parsed = JSON.parse(revision) as Array<{ id: string; startBeat: number; velocity: number }>;
        expect(parsed).toEqual([{ id: 'a', startBeat: 0, velocity: 100 }]);
    });

    it('returns "[]" for an empty note array', () => {
        expect(createGrooveSourceRevision([])).toBe('[]');
    });

    it('strips extraneous fields from each note (only id/startBeat/velocity kept)', () => {
        const noisy = [{ id: 'a', startBeat: 0, velocity: 100, extra: true, duration: 4 }];
        const revision = createGrooveSourceRevision(noisy);
        const parsed = JSON.parse(revision) as Array<Record<string, unknown>>;
        expect(Object.keys(parsed[0]!).sort()).toEqual(['id', 'startBeat', 'velocity']);
    });
});
