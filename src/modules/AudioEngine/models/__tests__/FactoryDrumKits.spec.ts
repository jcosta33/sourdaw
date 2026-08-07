import { describe, expect, it } from 'vitest';

import { FACTORY_KITS, getDrumKitById, getDrumKitByIndex } from '../FactoryDrumKits';

describe('FactoryDrumKits', () => {
    it('exports 6 factory kits', () => {
        expect(FACTORY_KITS).toHaveLength(6);
    });

    it('each kit has a unique id and non-empty name', () => {
        const ids = new Set<string>();
        for (const kit of FACTORY_KITS) {
            expect(kit.id).toBeTruthy();
            expect(kit.name).toBeTruthy();
            expect(ids.has(kit.id)).toBe(false);
            ids.add(kit.id);
        }
    });

    it('each kit has at least one voice', () => {
        for (const kit of FACTORY_KITS) {
            expect(kit.voices.length).toBeGreaterThan(0);
        }
    });

    it('each voice has a name and pitch range', () => {
        for (const kit of FACTORY_KITS) {
            for (const voice of kit.voices) {
                expect(voice.name).toBeTruthy();
                expect(voice.pitchRange).toHaveLength(2);
                expect(voice.pitchRange[0]).toBeLessThanOrEqual(voice.pitchRange[1]);
            }
        }
    });

    it('includes well-known kit ids', () => {
        const ids = FACTORY_KITS.map((k) => k.id);
        expect(ids).toContain('factory-808');
    });
});

describe('getDrumKitById', () => {
    it('returns the kit for a valid id', () => {
        const kit = getDrumKitById('factory-808');
        expect(kit).not.toBeNull();
        expect(kit?.id).toBe('factory-808');
    });

    it('returns null for an unknown id', () => {
        expect(getDrumKitById('nonexistent')).toBeNull();
    });
});

describe('getDrumKitByIndex', () => {
    it('returns the kit at the given index', () => {
        const kit = getDrumKitByIndex(0);
        expect(kit).not.toBeNull();
        expect(kit?.id).toBe(FACTORY_KITS[0]?.id);
    });

    it('returns the last kit at the last valid index', () => {
        const lastIndex = FACTORY_KITS.length - 1;
        const kit = getDrumKitByIndex(lastIndex);
        expect(kit).not.toBeNull();
        expect(kit?.id).toBe(FACTORY_KITS[lastIndex]?.id);
    });

    it('returns null for an out-of-bounds index', () => {
        expect(getDrumKitByIndex(99)).toBeNull();
        expect(getDrumKitByIndex(-1)).toBeNull();
    });
});
