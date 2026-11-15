import { afterEach, describe, expect, it } from 'vitest';

import {
    appliedAutomationBases,
    recordAppliedAutomationWrite,
    appliedAutomationWriteSequences,
    clearAppliedAutomationBases,
} from '../appliedAutomationBases';
import { readAppliedAutomationValue, readLatestAutomationWriteSequence } from '../readAppliedAutomationValue';

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

    it('reports a latest write sequence below every later write and equal to the last one', () => {
        recordAppliedAutomationWrite('device-a', '7');
        const issuedAt = readLatestAutomationWriteSequence();
        expect(readLatestAutomationWriteSequence()).toBe(issuedAt);

        recordAppliedAutomationWrite('device-b', '9');
        appliedAutomationBases.set('device-b', new Map([['9', 0.5]]));

        expect(readAppliedAutomationValue('device-b', '9')?.writeSequence).toBeGreaterThan(issuedAt);
        expect(readLatestAutomationWriteSequence()).toBe(readAppliedAutomationValue('device-b', '9')?.writeSequence);
    });
});
