import { afterEach, describe, expect, it } from 'vitest';

import { stepRecordStore } from '../../../stores/stepRecordStore';
import { toggleStepRecordingForClip } from '../toggleStepRecordingForClip';

import { makeStepRecordState, resetStepRecordNavigationStores } from './stepRecordNavigationTestHelpers';

describe('toggleStepRecordingForClip', () => {
    afterEach(() => {
        resetStepRecordNavigationStores();
    });

    it('should not create step-record state when the store is empty', () => {
        stepRecordStore.set(null);

        toggleStepRecordingForClip({ clipId: 'clip-a' });

        expect(stepRecordStore.value).toBeNull();
    });

    it('should activate step recording for the current clip and reset the current beat', () => {
        stepRecordStore.set(makeStepRecordState({ active: false, clipId: null, currentBeat: 4, currentPitch: 67 }));

        toggleStepRecordingForClip({ clipId: 'clip-a' });

        expect(stepRecordStore.value?.active).toBe(true);
        expect(stepRecordStore.value?.clipId).toBe('clip-a');
        expect(stepRecordStore.value?.currentBeat).toBe(0);
        expect(stepRecordStore.value?.currentPitch).toBe(67);
    });

    it('should deactivate step recording, clear the clip, and reset the current beat', () => {
        stepRecordStore.set(makeStepRecordState({ active: true, clipId: 'clip-a', currentBeat: 4, currentPitch: 67 }));

        toggleStepRecordingForClip({ clipId: 'clip-b' });

        expect(stepRecordStore.value?.active).toBe(false);
        expect(stepRecordStore.value?.clipId).toBeNull();
        expect(stepRecordStore.value?.currentBeat).toBe(0);
        expect(stepRecordStore.value?.currentPitch).toBe(67);
    });
});
