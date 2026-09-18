/**
 * The renderer's reading of `BuiltinEffectType::sounds_notes` (#3893): whether
 * a device type's built-in body is one the engine registers a note store for.
 */

import { describe, expect, it } from 'vitest';

import { soundsNativeNotes } from '../soundsNativeNotes';

describe('soundsNativeNotes', () => {
    it('answers true for a built-in whose body sounds notes, case-folded like the mapper', () => {
        expect(soundsNativeNotes('fermenter')).toBe(true);
        expect(soundsNativeNotes('Fermenter')).toBe(true);
        expect(soundsNativeNotes('grand-boule')).toBe(true);
        expect(soundsNativeNotes('Grand-Boule')).toBe(true);
    });

    // The sampler voices notes from staged material rather than from its own
    // record, but the store the engine registers for it is the same store: a
    // strip whose instrument is the sampler has a native note sink, and
    // answering false here is how its part goes silent under a native carrier.
    it('answers true for the orchestral sampler', () => {
        expect(soundsNativeNotes('levain')).toBe(true);
        expect(soundsNativeNotes('Levain')).toBe(true);
    });

    it('answers false for a built-in effect, and for a type with no body at all', () => {
        expect(soundsNativeNotes('knead')).toBe(false);
        expect(soundsNativeNotes('external-plugin')).toBe(false);
        expect(soundsNativeNotes('yeast')).toBe(false);
    });
});
