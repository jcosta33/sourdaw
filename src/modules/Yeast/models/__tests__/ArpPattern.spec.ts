import { describe, expect, it } from 'vitest';

import { type ArpStep } from '../ArpPattern';
import { createDefaultPattern, defaultStep } from '../ArpPattern';

describe('defaultStep', () => {
    it('returns the canonical step object', () => {
        expect(defaultStep()).toEqual({
            active: true,
            stepType: 'note',
            noteSelector: { type: 'next' },
            velocity: 100,
            velocityOverride: false,
            gateMul: 1.0,
            octaveOffset: 0,
            semitoneOffset: 0,
            probability: 1.0,
            ratchet: 1,
        });
    });

    it('produces a fresh object each call (no shared mutation)', () => {
        const a = defaultStep();
        const b = defaultStep();
        a.velocity = 1;
        a.octaveOffset = 2;
        a.noteSelector = { type: 'previous' };
        expect(b.velocity).toBe(100);
        expect(b.octaveOffset).toBe(0);
        expect(b.noteSelector).toEqual({ type: 'next' });
    });
});

describe('createDefaultPattern', () => {
    it('builds an array of the requested length where every step equals defaultStep', () => {
        const pattern: ArpStep[] = createDefaultPattern(4);
        expect(pattern).toHaveLength(4);
        for (const step of pattern) {
            expect(step).toEqual(defaultStep());
        }
    });

    it('returns an empty array for length 0', () => {
        expect(createDefaultPattern(0)).toEqual([]);
    });

    it('produces independent step objects (mutating one does not affect siblings)', () => {
        const pattern = createDefaultPattern(3);
        pattern[0]!.active = false;
        pattern[0]!.velocity = 42;
        expect(pattern[1]!.active).toBe(true);
        expect(pattern[2]!.velocity).toBe(100);
    });
});
