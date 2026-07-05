import { afterEach, describe, expect, it } from 'vitest';

import { stepRecordStore } from '../../../stores/stepRecordStore';
import { setStepRecordBeat } from '../setStepRecordBeat';

import { makeStepRecordState, resetStepRecordNavigationStores } from './stepRecordNavigationTestHelpers';

describe('setStepRecordBeat', () => {
    afterEach(() => {
        resetStepRecordNavigationStores();
    });

    it('should not create step-record state when the store is empty', () => {
        stepRecordStore.set(null);

        setStepRecordBeat(2);

        expect(stepRecordStore.value).toBeNull();
    });

    it('should set the current beat from a numeric value', () => {
        stepRecordStore.set(makeStepRecordState({ active: false, currentBeat: 1.25, currentPitch: 72 }));

        setStepRecordBeat(3.5);

        expect(stepRecordStore.value?.currentBeat).toBe(3.5);
        expect(stepRecordStore.value?.currentPitch).toBe(72);
    });

    it('should set the current beat from an updater function', () => {
        stepRecordStore.set(makeStepRecordState({ active: true, currentBeat: 1.25, stepSize: 0.5 }));

        setStepRecordBeat((currentBeat) => currentBeat + 0.5);

        expect(stepRecordStore.value?.currentBeat).toBe(1.75);
        expect(stepRecordStore.value?.stepSize).toBe(0.5);
    });
});
