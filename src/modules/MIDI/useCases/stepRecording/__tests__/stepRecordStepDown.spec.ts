import { afterEach, describe, expect, it } from 'vitest';

import { projectStore } from '#/modules/Project/stores';

import { stepRecordStore } from '../../../stores/stepRecordStore';
import { stepRecordStepDown } from '../stepRecordStepDown';

import {
    makeProjectState,
    makeStepRecordState,
    resetStepRecordNavigationStores,
} from './stepRecordNavigationTestHelpers';

describe('stepRecordStepDown', () => {
    afterEach(() => {
        resetStepRecordNavigationStores();
    });

    it('should not change the current pitch when step recording is inactive', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'major' }));
        stepRecordStore.set(makeStepRecordState({ active: false, currentPitch: 60 }));

        stepRecordStepDown();

        expect(stepRecordStore.value?.currentPitch).toBe(60);
    });

    it('should step chromatically when the project scale is chromatic', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'chromatic' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 60 }));

        stepRecordStepDown();

        expect(stepRecordStore.value?.currentPitch).toBe(59);
    });

    it('should step to the previous scale degree using the project key root', () => {
        projectStore.set(makeProjectState({ keyRoot: 2, scaleName: 'major' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 64 }));

        stepRecordStepDown();

        expect(stepRecordStore.value?.currentPitch).toBe(62);
    });

    it('should force off-scale pitches to the previous scale degree before stepping down', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'major' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 61 }));

        stepRecordStepDown();

        expect(stepRecordStore.value?.currentPitch).toBe(59);
    });

    it('should wrap below the first scale degree to the previous octave', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'major' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 60 }));

        stepRecordStepDown();

        expect(stepRecordStore.value?.currentPitch).toBe(59);
    });

    it('should step below off-scale pitches past the last scale degree', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'pentatonicMajor' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 70 }));

        stepRecordStepDown();

        expect(stepRecordStore.value?.currentPitch).toBe(67);
    });

    it('should clamp the current pitch to zero', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'chromatic' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 0 }));

        stepRecordStepDown();

        expect(stepRecordStore.value?.currentPitch).toBe(0);
    });
});
