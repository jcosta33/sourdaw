import { describe, expect, it } from 'vitest';

import { type ArpStep } from '../ArpPattern';
import {
    ARP_PATTERN_LENGTH_PARAM,
    clampArpPatternLength,
    createDefaultPattern,
    decodeArpPatternParams,
    DEFAULT_ARP_PATTERN_LENGTH,
    defaultStep,
    encodeArpPatternParams,
    MAX_ARP_PATTERN_LENGTH,
    stripArpPatternParams,
    withArpPatternParams,
} from '../ArpPattern';

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

describe('arp pattern param codec', () => {
    it('round-trips every field of every step through the numeric param channel', () => {
        const pattern: ArpStep[] = [
            {
                active: false,
                stepType: 'tie',
                noteSelector: { type: 'index', index: 3 },
                velocity: 17,
                velocityOverride: true,
                gateMul: 0.35,
                octaveOffset: -2,
                semitoneOffset: 7,
                probability: 0.25,
                ratchet: 4,
            },
            {
                active: true,
                stepType: 'chord',
                noteSelector: { type: 'highest' },
                velocity: 127,
                velocityOverride: false,
                gateMul: 1.75,
                octaveOffset: 3,
                semitoneOffset: -12,
                probability: 1,
                ratchet: 2,
            },
            defaultStep(),
        ];

        const params = encodeArpPatternParams(pattern);
        // The channel is numeric-only: the Automerge codec, the Worker message
        // validator and `MidiRack.replaceParams` all reject or drop anything else.
        for (const value of Object.values(params)) {
            expect(typeof value).toBe('number');
            expect(Number.isFinite(value)).toBe(true);
        }
        expect(decodeArpPatternParams(params)).toEqual(pattern);
    });

    it('omits fields equal to the step default so a default pattern costs one key', () => {
        expect(encodeArpPatternParams(createDefaultPattern(4))).toEqual({ [ARP_PATTERN_LENGTH_PARAM]: 4 });
    });

    it('decodes a projection with no stored pattern to the default pattern', () => {
        // The forward-compatibility contract: a project saved before the pattern
        // channel existed carries arpeggiator params but no `pattern_len`.
        const legacyParams = { mode: 7, rate_denom: 16, gate: 0.8, latch: 1 };
        expect(decodeArpPatternParams(legacyParams)).toEqual(createDefaultPattern(DEFAULT_ARP_PATTERN_LENGTH));
        expect(decodeArpPatternParams(undefined)).toEqual(createDefaultPattern(DEFAULT_ARP_PATTERN_LENGTH));
        expect(decodeArpPatternParams({})).toEqual(createDefaultPattern(DEFAULT_ARP_PATTERN_LENGTH));
    });

    it('restores per-field defaults for step fields a stored pattern omits', () => {
        // A document written by a peer that did not know a field decodes it to
        // the step default rather than to zero.
        const steps = decodeArpPatternParams({ [ARP_PATTERN_LENGTH_PARAM]: 2, pattern_0_velocity: 40 });
        expect(steps).toHaveLength(2);
        expect(steps[0]).toEqual({ ...defaultStep(), velocity: 40 });
        expect(steps[1]).toEqual(defaultStep());
    });

    it('clamps hostile or out-of-range values a peer could write into the document', () => {
        const steps = decodeArpPatternParams({
            [ARP_PATTERN_LENGTH_PARAM]: 9999,
            pattern_0_velocity: 5000,
            pattern_0_gate: 99,
            pattern_0_octave: -50,
            pattern_0_semitone: 400,
            pattern_0_probability: -3,
            pattern_0_ratchet: 64,
            pattern_0_type: 99,
        });
        expect(steps).toHaveLength(MAX_ARP_PATTERN_LENGTH);
        expect(steps[0]).toEqual({
            ...defaultStep(),
            velocity: 127,
            gateMul: 2.0,
            octaveOffset: -3,
            semitoneOffset: 12,
            probability: 0,
            ratchet: 4,
            stepType: 'random',
        });
    });

    it('clamps the encoded length to the carriable range', () => {
        expect(clampArpPatternLength(0)).toBe(1);
        expect(clampArpPatternLength(1000)).toBe(MAX_ARP_PATTERN_LENGTH);
        expect(clampArpPatternLength(Number.NaN)).toBe(DEFAULT_ARP_PATTERN_LENGTH);
        expect(encodeArpPatternParams(createDefaultPattern(100))[ARP_PATTERN_LENGTH_PARAM]).toBe(
            MAX_ARP_PATTERN_LENGTH
        );
    });

    it('leaves non-pattern params untouched and drops steps beyond a shortened pattern', () => {
        const before = withArpPatternParams({ mode: 7, gate: 0.5 }, [
            { ...defaultStep(), velocity: 12 },
            { ...defaultStep(), velocity: 13 },
            { ...defaultStep(), velocity: 14 },
        ]);
        expect(before.pattern_2_velocity).toBe(14);

        const after = withArpPatternParams(before, decodeArpPatternParams(before).slice(0, 2));
        expect(after.mode).toBe(7);
        expect(after.gate).toBe(0.5);
        expect(after[ARP_PATTERN_LENGTH_PARAM]).toBe(2);
        // A stale step left behind would resurrect on a later length increase.
        expect(after.pattern_2_velocity).toBeUndefined();
    });

    it('strips only the pattern-prefixed keys', () => {
        expect(stripArpPatternParams({ mode: 7, [ARP_PATTERN_LENGTH_PARAM]: 4, pattern_0_velocity: 9 })).toEqual({
            mode: 7,
        });
    });
});
