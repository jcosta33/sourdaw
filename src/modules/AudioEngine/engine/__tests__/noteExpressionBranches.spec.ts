import { describe, it, expect } from 'vitest';

import {
    normalizeNoteExpression,
    hasNoteExpression,
    resolveNoteExpressionControls,
    MPE_MEMBER_BEND_RANGE_SEMITONES,
} from '../noteExpression';

describe('normalizeNoteExpression — bend conversion and clamping', () => {
    it('converts pitchBend=0 to 0 semitones', () => {
        const result = normalizeNoteExpression({ pitchBend: 0 });
        expect(result.bendSemitones).toBe(0);
    });

    it('converts pitchBend=8191 to near +bendRange semitones', () => {
        const result = normalizeNoteExpression({ pitchBend: 8191 });
        // 8191/8192 * 48 ≈ 47.994 (not exactly 48 — the max wire value is 8191, not 8192)
        expect(result.bendSemitones).toBeCloseTo((8191 / 8192) * MPE_MEMBER_BEND_RANGE_SEMITONES, 3);
    });

    it('converts pitchBend=-8192 to -bendRange semitones (clamped)', () => {
        const result = normalizeNoteExpression({ pitchBend: -8192 });
        expect(result.bendSemitones).toBeCloseTo(-MPE_MEMBER_BEND_RANGE_SEMITONES, 5);
    });

    it('clamps pitchBend > 8191 to the maximum', () => {
        const result = normalizeNoteExpression({ pitchBend: 16_383 });
        // 16383 clamps to 8191, then (8191/8192)*48 ≈ 47.994
        expect(result.bendSemitones).toBeCloseTo((8191 / 8192) * MPE_MEMBER_BEND_RANGE_SEMITONES, 3);
    });

    it('clamps pitchBend < -8192 to the minimum', () => {
        const result = normalizeNoteExpression({ pitchBend: -16_383 });
        // -16383 clamps to -8192, then (-8192/8192)*48 = -48
        expect(result.bendSemitones).toBeCloseTo(-MPE_MEMBER_BEND_RANGE_SEMITONES, 3);
    });

    it('respects a custom bendRangeSemitones', () => {
        const result = normalizeNoteExpression({ pitchBend: 8192 }, 12);
        // 8192/8192 * 12 = 12 (but 8192 clamps to 8191 → 8191/8192 * 12 ≈ 11.999)
        expect(result.bendSemitones).toBeCloseTo(12 * (8191 / 8192), 2);
    });

    it('defaults missing pitchBend to 0 semitones', () => {
        const result = normalizeNoteExpression({ pressure: 64 });
        expect(result.bendSemitones).toBe(0);
    });
});

describe('normalizeNoteExpression — pressure conversion and clamping', () => {
    it('converts pressure=127 to 1.0', () => {
        expect(normalizeNoteExpression({ pressure: 127 }).pressure).toBeCloseTo(1, 5);
    });

    it('converts pressure=0 to 0.0', () => {
        expect(normalizeNoteExpression({ pressure: 0 }).pressure).toBe(0);
    });

    it('clamps pressure > 127 to 1.0', () => {
        expect(normalizeNoteExpression({ pressure: 200 }).pressure).toBeCloseTo(1, 5);
    });

    it('defaults missing pressure to 0', () => {
        expect(normalizeNoteExpression({ pitchBend: 0 }).pressure).toBe(0);
    });
});

describe('normalizeNoteExpression — slide conversion and clamping', () => {
    it('converts slide=64 (neutral) to 0.0', () => {
        expect(normalizeNoteExpression({ slide: 64 }).slide).toBeCloseTo(0, 5);
    });

    it('converts slide=127 to +1.0', () => {
        expect(normalizeNoteExpression({ slide: 127 }).slide).toBeCloseTo(1, 5);
    });

    it('converts slide=0 to -1.0 (clamped via (0-64)/63)', () => {
        expect(normalizeNoteExpression({ slide: 0 }).slide).toBeCloseTo(-64 / 63, 5);
    });

    it('clamps slide > 127', () => {
        expect(normalizeNoteExpression({ slide: 200 }).slide).toBeCloseTo(1, 5);
    });

    it('defaults missing slide to 0', () => {
        expect(normalizeNoteExpression({ pressure: 0 }).slide).toBe(0);
    });
});

describe('hasNoteExpression', () => {
    it('returns false for undefined', () => {
        expect(hasNoteExpression(undefined)).toBe(false);
    });

    it('returns false for an empty object', () => {
        expect(hasNoteExpression({})).toBe(false);
    });

    it('returns true when pitchBend is present', () => {
        expect(hasNoteExpression({ pitchBend: 0 })).toBe(true);
    });

    it('returns true when pressure is present', () => {
        expect(hasNoteExpression({ pressure: 0 })).toBe(true);
    });

    it('returns true when slide is present', () => {
        expect(hasNoteExpression({ slide: 64 })).toBe(true);
    });
});

describe('resolveNoteExpressionControls', () => {
    it('returns null for an empty device list', () => {
        expect(resolveNoteExpressionControls([])).toBeNull();
    });

    it('returns null when no device is expression-capable', () => {
        const nodes = [{ type: 'gluten' }, { type: 'crust' }] as never;
        expect(resolveNoteExpressionControls(nodes)).toBeNull();
    });

    it('returns null when a fermenter device has no controls', () => {
        const nodes = [{ type: 'fermenter', fermenterControls: null }] as never;
        expect(resolveNoteExpressionControls(nodes)).toBeNull();
    });

    it('returns the controls when a fermenter device has a noteExpression function', () => {
        const noteExpression = () => {};
        const nodes = [{ type: 'fermenter', fermenterControls: { noteExpression } }] as never;
        const result = resolveNoteExpressionControls(nodes);
        expect(result).not.toBeNull();
        expect(typeof result?.noteExpression).toBe('function');
    });

    it('finds the first matching device in a mixed list', () => {
        const noteExpression = () => {};
        const nodes = [{ type: 'gluten' }, { type: 'levain', levainControls: { noteExpression } }] as never;
        const result = resolveNoteExpressionControls(nodes);
        expect(result).not.toBeNull();
    });

    it('skips a device with controls but no noteExpression function', () => {
        const noteExpression = () => {};
        const nodes = [
            { type: 'fermenter', fermenterControls: { volume: 1 } },
            { type: 'levain', levainControls: { noteExpression } },
        ] as never;
        const result = resolveNoteExpressionControls(nodes);
        expect(result).not.toBeNull();
    });
});
