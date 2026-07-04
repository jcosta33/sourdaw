import { afterEach, describe, expect, it } from 'vitest';

import { projectStore } from '#/modules/Project/stores';

import { stepRecordStore } from '../../../stores/stepRecordStore';
import { stepRecordStepUp } from '../stepRecordStepUp';

import {
    makeProjectState,
    makeStepRecordState,
    resetStepRecordNavigationStores,
} from './stepRecordNavigationTestHelpers';

describe('stepRecordStepUp', () => {
    afterEach(() => {
        resetStepRecordNavigationStores();
    });

    it('should not change the current pitch when step recording is inactive', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'major' }));
        stepRecordStore.set(makeStepRecordState({ active: false, currentPitch: 60 }));

        stepRecordStepUp();

        expect(stepRecordStore.value?.currentPitch).toBe(60);
    });

    it('should step chromatically when the project scale is chromatic', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'chromatic' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 60 }));

        stepRecordStepUp();

        expect(stepRecordStore.value?.currentPitch).toBe(61);
    });

    it('should step to the next scale degree using the project key root', () => {
        projectStore.set(makeProjectState({ keyRoot: 2, scaleName: 'major' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 62 }));

        stepRecordStepUp();

        expect(stepRecordStore.value?.currentPitch).toBe(64);
    });

    it('should force off-scale pitches to the next scale degree before stepping up', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'major' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 61 }));

        stepRecordStepUp();

        expect(stepRecordStore.value?.currentPitch).toBe(64);
    });

    it('should wrap above the last scale degree to the next octave', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'major' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 71 }));

        stepRecordStepUp();

        expect(stepRecordStore.value?.currentPitch).toBe(72);
    });

    it('should preserve the first-degree fallback for off-scale pitches past the last scale degree', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'pentatonicMajor' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 70 }));

        stepRecordStepUp();

        expect(stepRecordStore.value?.currentPitch).toBe(62);
    });

    it('should clamp the current pitch to 127', () => {
        projectStore.set(makeProjectState({ keyRoot: 0, scaleName: 'chromatic' }));
        stepRecordStore.set(makeStepRecordState({ active: true, currentPitch: 127 }));

        stepRecordStepUp();

        expect(stepRecordStore.value?.currentPitch).toBe(127);
    });
});
