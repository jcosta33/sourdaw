import { describe, expect, it } from 'vitest';

import { readLastObservationSequence, takeNextObservationSequence } from '../observationSequence';

describe('observationSequence', () => {
    it('numbers each observation above the last read and reads back the latest number', () => {
        const before = readLastObservationSequence();

        const first = takeNextObservationSequence();
        const second = takeNextObservationSequence();

        expect(first).toBeGreaterThan(before);
        expect(second).toBeGreaterThan(first);
        expect(readLastObservationSequence()).toBe(second);
    });

    it('does not advance when only read', () => {
        const before = readLastObservationSequence();

        expect(readLastObservationSequence()).toBe(before);
        expect(readLastObservationSequence()).toBe(before);
    });
});
