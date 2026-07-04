import { afterEach, describe, expect, it } from 'vitest';

import { stepRecordStore } from '../../../stores/stepRecordStore';
import { stepRecordRetreat } from '../stepRecordRetreat';

import { makeStepRecordState, resetStepRecordNavigationStores } from './stepRecordNavigationTestHelpers';

describe('stepRecordRetreat', () => {
    afterEach(() => {
        resetStepRecordNavigationStores();
    });

    it('should not change the current beat when step recording is inactive', () => {
        stepRecordStore.set(makeStepRecordState({ active: false, currentBeat: 2, stepSize: 0.5 }));

        stepRecordRetreat();

        expect(stepRecordStore.value?.currentBeat).toBe(2);
    });

    it('should subtract the step size from the current beat when step recording is active', () => {
        stepRecordStore.set(makeStepRecordState({ active: true, currentBeat: 2, stepSize: 0.5 }));

        stepRecordRetreat();

        expect(stepRecordStore.value?.currentBeat).toBe(1.5);
    });

    it('should clamp the current beat to zero', () => {
        stepRecordStore.set(makeStepRecordState({ active: true, currentBeat: 0.125, stepSize: 0.25 }));

        stepRecordRetreat();

        expect(stepRecordStore.value?.currentBeat).toBe(0);
    });
});
