import { describe, expect, it } from 'vitest';

import { isNativeSdkDurationWithinBudget } from '../e2eNativeTaskBudget';

describe('isNativeSdkDurationWithinBudget', () => {
    // Cold Detect in Health run 44185135235, with no browser long-task entry.
    it.each([
        { operation: 'apply', taskMs: 47.62, sdkMs: 44.835, referenceMedianMs: 19.375 },
        { operation: 'decode', taskMs: 42.632, sdkMs: 41.37, referenceMedianMs: 15.63 },
    ])(
        'admits a responsive cold $operation task with a valid faster reference',
        ({ taskMs, sdkMs, referenceMedianMs }) => {
            expect(isNativeSdkDurationWithinBudget(taskMs, false, sdkMs, referenceMedianMs)).toBe(true);
        }
    );

    it('requires the SDK allowance at exactly 50 ms', () => {
        expect(isNativeSdkDurationWithinBudget(50, false, 45, 20)).toBe(false);
    });

    it('requires the SDK allowance when the observer matched a shorter trace task', () => {
        expect(isNativeSdkDurationWithinBudget(49.9, true, 45, 20)).toBe(false);
        expect(isNativeSdkDurationWithinBudget(49.9, true, 45, 23)).toBe(true);
    });

    it('allows only up to twice the SDK reference in a long task', () => {
        expect(isNativeSdkDurationWithinBudget(74, true, 70, 35)).toBe(true);
        expect(isNativeSdkDurationWithinBudget(74, false, 70.001, 35)).toBe(false);
    });

    describe.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('invalid duration %s', (durationMs) => {
        it('rejects an invalid renderer task duration', () => {
            expect(isNativeSdkDurationWithinBudget(durationMs, false, 38, 20)).toBe(false);
        });

        it('rejects an invalid SDK span even in a short task', () => {
            expect(isNativeSdkDurationWithinBudget(40, false, durationMs, 20)).toBe(false);
        });
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid reference median %s even in a short task',
        (medianMs) => {
            expect(isNativeSdkDurationWithinBudget(40, false, 38, medianMs)).toBe(false);
        }
    );
});
