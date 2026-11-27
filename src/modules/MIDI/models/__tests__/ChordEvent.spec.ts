import { describe, expect, it } from 'vitest';

import { compareChordEvents, createChordEvent, formatChordName } from '../ChordEvent';

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
        expect(ev.id).toMatch(/^chord-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});

describe('compareChordEvents', () => {
    const at = (id: string, beat: number) => ({ id, beat, root: 0, quality: 'major' as const, duration: 4 });

    it('orders by beat, then by id, and ties only an identical beat and id', () => {
        expect(compareChordEvents(at('b', 1), at('a', 2))).toBeLessThan(0);
        expect(compareChordEvents(at('a', 2), at('b', 1))).toBeGreaterThan(0);
        expect(compareChordEvents(at('a', 1), at('b', 1))).toBe(-1);
        expect(compareChordEvents(at('b', 1), at('a', 1))).toBe(1);
        expect(compareChordEvents(at('a', 1), at('a', 1))).toBe(0);
    });
});
