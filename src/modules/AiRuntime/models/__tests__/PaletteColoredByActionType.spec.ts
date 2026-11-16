import { describe, expect, it } from 'vitest';

import { paletteColoredByActionType } from '../PaletteColoredByActionType';

describe('paletteColoredByActionType', () => {
    it('marks exactly the track and bus creations as drawing a palette color', () => {
        const colored = Object.entries(paletteColoredByActionType)
            .filter(([, isColored]) => isColored)
            .map(([type]) => type);

        expect(colored.toSorted()).toEqual(['addTrack', 'createBus']);
    });

    it('leaves an action type the list does not name uncolored', () => {
        expect(paletteColoredByActionType.renameTrack).toBe(false);
    });
});
