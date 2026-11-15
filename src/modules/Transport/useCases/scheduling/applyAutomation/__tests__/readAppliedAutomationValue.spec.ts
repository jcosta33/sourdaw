import { afterEach, describe, expect, it } from 'vitest';

import {
    appliedAutomationBases,
    appliedAutomationWriteSequences,
    clearAppliedAutomationBases,
} from '../appliedAutomationBases';
import { readAppliedAutomationValue } from '../readAppliedAutomationValue';

describe('readAppliedAutomationValue', () => {
    afterEach(() => {
        appliedAutomationBases.clear();
        appliedAutomationWriteSequences.clear();
    });

    it('returns the value and write sequence recorded for the device parameter', () => {
        appliedAutomationBases.set('device-a', new Map([['7', 0.625]]));
        appliedAutomationBases.set('device-b', new Map([['7', 0.125]]));
        appliedAutomationWriteSequences.set('device-a', new Map([['7', 4]]));
        appliedAutomationWriteSequences.set('device-b', new Map([['7', 9]]));

        expect(readAppliedAutomationValue('device-a', '7')).toEqual({ value: 0.625, writeSequence: 4 });
        expect(readAppliedAutomationValue('device-b', '7')).toEqual({ value: 0.125, writeSequence: 9 });
    });

    it('returns undefined for a parameter or device no lane drove', () => {
        appliedAutomationBases.set('device-a', new Map([['7', 0.625]]));

        expect(readAppliedAutomationValue('device-a', '8')).toBeUndefined();
        expect(readAppliedAutomationValue('device-c', '7')).toBeUndefined();
    });

    it('returns undefined once the next tick clears the bases, and keeps the sequence for the tick after', () => {
        appliedAutomationBases.set('device-a', new Map([['7', 0.625]]));
        appliedAutomationWriteSequences.set('device-a', new Map([['7', 4]]));

        clearAppliedAutomationBases();

        expect(readAppliedAutomationValue('device-a', '7')).toBeUndefined();
        appliedAutomationBases.get('device-a')!.set('7', 0.625);
        expect(readAppliedAutomationValue('device-a', '7')).toEqual({ value: 0.625, writeSequence: 4 });
    });
});
