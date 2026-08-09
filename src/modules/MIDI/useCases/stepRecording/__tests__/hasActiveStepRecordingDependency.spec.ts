import { afterEach, describe, expect, it } from 'vitest';

import { defaultStepRecordState, stepRecordStore } from '../../../stores/stepRecordStore';
import { hasActiveStepRecordingDependency } from '../hasActiveStepRecordingDependency';

describe('hasActiveStepRecordingDependency', () => {
    afterEach(() => {
        stepRecordStore.set(null);
    });

    it('reports only an active step-recording target in the affected set', () => {
        stepRecordStore.set({
            ...defaultStepRecordState,
            active: true,
            clipId: 'clip-a',
            activeNotes: new Set<number>(),
        });

        expect(hasActiveStepRecordingDependency(['clip-a', 'clip-b'])).toBe(true);
        expect(hasActiveStepRecordingDependency(['clip-b', 'clip-c'])).toBe(false);
    });

    it('ignores an inactive retained target', () => {
        stepRecordStore.set({
            ...defaultStepRecordState,
            active: false,
            clipId: 'clip-a',
            activeNotes: new Set<number>(),
        });

        expect(hasActiveStepRecordingDependency(['clip-a'])).toBe(false);
    });
});
