import { describe, expect, it } from 'vitest';

import {
    getMarkerColorNames,
    MARKER_COLOR_PRESET_VALUES,
    resolveMarkerColorName,
    resolveMarkerColorValue,
} from '../markerColorPalette';

describe('markerColorPalette', () => {
    it('maps every semantic name to the canonical preset and back', () => {
        const names = getMarkerColorNames();

        expect(names).toHaveLength(MARKER_COLOR_PRESET_VALUES.length);
        expect(names.map((name) => resolveMarkerColorValue(name))).toEqual(MARKER_COLOR_PRESET_VALUES);
        expect(MARKER_COLOR_PRESET_VALUES.map((value) => resolveMarkerColorName(value))).toEqual(names);
    });

    it('rejects unknown names and values', () => {
        expect(resolveMarkerColorValue('orange')).toBeNull();
        expect(resolveMarkerColorName('#ff8800')).toBeNull();
    });
});
