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
    });

    it('answers false for a built-in effect, and for a type with no body at all', () => {
        expect(soundsNativeNotes('knead')).toBe(false);
        expect(soundsNativeNotes('external-plugin')).toBe(false);
        expect(soundsNativeNotes('yeast')).toBe(false);
    });
});
