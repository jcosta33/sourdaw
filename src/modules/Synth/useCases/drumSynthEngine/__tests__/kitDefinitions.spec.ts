import { describe, it, expect } from 'vitest';
import { KIT_808_DEF, DRUM_KIT_DEFS, getDrumKitDefByIndex } from '../kitDefinitions/getDrumKitDefByIndex';

describe('drum kit definitions', () => {
    it('KIT_808_DEF has the expected name and a non-empty voice list', () => {
        expect(KIT_808_DEF.id).toBe('kit-808');
        expect(KIT_808_DEF.voices.length).toBeGreaterThan(0);
        expect(KIT_808_DEF.voices.find((v) => v.name === 'Kick')).toBeDefined();
    });

    it('DRUM_KIT_DEFS contains KIT_808_DEF', () => {
        expect(DRUM_KIT_DEFS).toContain(KIT_808_DEF);
    });

    it('getDrumKitDefByIndex returns the kit at index, or null', () => {
        expect(getDrumKitDefByIndex(0)).toBe(KIT_808_DEF);
        expect(getDrumKitDefByIndex(99)).toBeNull();
    });
});
