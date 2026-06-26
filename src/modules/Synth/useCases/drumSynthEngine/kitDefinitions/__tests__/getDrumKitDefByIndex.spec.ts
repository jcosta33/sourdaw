import { describe, it, expect } from 'vitest';

import { KIT_808_DEF, DRUM_KIT_DEFS, getDrumKitDefByIndex } from '../getDrumKitDefByIndex';

describe('getDrumKitDefByIndex', () => {
    it('returns the 808 kit for index 0', () => {
        const kit = getDrumKitDefByIndex(0);
        expect(kit).toBe(KIT_808_DEF);
        expect(kit?.id).toBe('kit-808');
    });

    it('returns null for an out-of-range index', () => {
        expect(getDrumKitDefByIndex(DRUM_KIT_DEFS.length)).toBeNull();
        expect(getDrumKitDefByIndex(-1)).toBeNull();
    });
});
