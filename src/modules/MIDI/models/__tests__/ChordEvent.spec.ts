import { describe, expect, it } from 'vitest';

import { createChordEvent, formatChordName } from '../ChordEvent';

describe('formatChordName', () => {
    it('uses root name and omits suffix for major', () => {
        expect(
            formatChordName({
                id: 'x',
                beat: 0,
                root: 0,
                quality: 'major',
                duration: 4,
            })
        ).toBe('C');
    });

    it('appends quality for non-major chords', () => {
        expect(
            formatChordName({
                id: 'x',
                beat: 0,
                root: 2,
                quality: 'minor',
                duration: 4,
            })
        ).toBe('Dminor');
    });

    it('normalizes root modulo 12', () => {
        expect(
            formatChordName({
                id: 'x',
                beat: 0,
                root: 14,
                quality: 'major',
                duration: 4,
            })
        ).toBe('D');
    });
});

describe('createChordEvent', () => {
    it('wraps root to 0–11 and returns a chord id prefix', () => {
        const ev = createChordEvent(1, 26, 'dim', 2);
        expect(ev.beat).toBe(1);
        expect(ev.root).toBe(2);
        expect(ev.quality).toBe('dim');
        expect(ev.duration).toBe(2);
        expect(ev.id).toMatch(/^chord-[0-9a-f]{8}$/);
    });
});
