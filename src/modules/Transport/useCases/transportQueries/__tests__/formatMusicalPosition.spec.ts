import { beforeEach, describe, expect, it } from 'vitest';

import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { transportStore } from '../../../stores/transportStore';
import { formatMusicalLength } from '../formatMusicalLength';
import { formatMusicalPosition } from '../formatMusicalPosition';

describe('formatMusicalPosition', () => {
    beforeEach(() => {
        transportStore.set({ ...transportStore.value!, timeSignatureNumerator: 4, timeSignatureDenominator: 4 });
        timeSignatureMapStore.set({ changes: [] });
    });

    it('formats through the live 4/4 meter', () => {
        expect(formatMusicalPosition(31.666666666666668)).toBe('8.4.4');
        expect(formatMusicalLength(31.666666666666668, 3.874666666666304)).toBe('0.3.3');
    });

    it('follows the transport time signature', () => {
        transportStore.set({ ...transportStore.value!, timeSignatureNumerator: 3, timeSignatureDenominator: 4 });

        expect(formatMusicalPosition(9)).toBe('4.1.1');
        expect(formatMusicalLength(0, 9)).toBe('3.0.0');
    });

    it('follows a meter change in the map', () => {
        timeSignatureMapStore.set({ changes: [{ id: 'ts-1', beat: 8, numerator: 3, denominator: 4 }] });

        expect(formatMusicalPosition(11)).toBe('4.1.1');
        expect(formatMusicalLength(8, 6)).toBe('2.0.0');
    });
});
