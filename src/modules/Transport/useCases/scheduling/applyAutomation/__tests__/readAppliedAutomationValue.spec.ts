import { afterEach, describe, expect, it } from 'vitest';

import { appliedAutomationBases, clearAppliedAutomationBases } from '../appliedAutomationBases';
import { readAppliedAutomationValue } from '../readAppliedAutomationValue';

describe('readAppliedAutomationValue', () => {
    afterEach(() => {
        appliedAutomationBases.clear();
    });

    it('returns the value recorded for the device parameter on the current tick', () => {
        appliedAutomationBases.set('device-a', new Map([['7', 0.625]]));
        appliedAutomationBases.set('device-b', new Map([['7', 0.125]]));

        expect(readAppliedAutomationValue('device-a', '7')).toBe(0.625);
        expect(readAppliedAutomationValue('device-a', '7')).toBe(0.625);
        expect(readAppliedAutomationValue('device-b', '7')).toBe(0.125);
    });

    it('returns undefined for a parameter or device no lane drove', () => {
        appliedAutomationBases.set('device-a', new Map([['7', 0.625]]));

        expect(readAppliedAutomationValue('device-a', '8')).toBeUndefined();
        expect(readAppliedAutomationValue('device-c', '7')).toBeUndefined();
    });

    it('returns undefined once the next tick clears the map', () => {
        appliedAutomationBases.set('device-a', new Map([['7', 0.625]]));

        clearAppliedAutomationBases();

        expect(readAppliedAutomationValue('device-a', '7')).toBeUndefined();
    });
});
