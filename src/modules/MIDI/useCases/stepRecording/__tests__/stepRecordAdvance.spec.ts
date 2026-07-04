import { afterEach, describe, expect, it } from 'vitest';

import { stepRecordStore } from '../../../stores/stepRecordStore';
import { stepRecordAdvance } from '../stepRecordAdvance';

import { makeStepRecordState, resetStepRecordNavigationStores } from './stepRecordNavigationTestHelpers';

describe('stepRecordAdvance', () => {
    afterEach(() => {
        resetStepRecordNavigationStores();
    });

    it('should not change the current beat when step recording is inactive', () => {
        stepRecordStore.set(makeStepRecordState({ active: false, currentBeat: 2, stepSize: 0.5 }));

        stepRecordAdvance();

        expect(stepRecordStore.value?.currentBeat).toBe(2);
    });

    it('should add the step size to the current beat when step recording is active', () => {
        stepRecordStore.set(makeStepRecordState({ active: true, currentBeat: 2, stepSize: 0.5 }));

        stepRecordAdvance();

        expect(stepRecordStore.value?.currentBeat).toBe(2.5);
    });
});
