import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultKit } from '../../../models/ToasterKit';
import { defaultToasterState, toasterStore } from '../../../stores/toasterStore';
import { setStepCondition } from '../setStepCondition';

const DEVICE_ID = 'toaster-condition-device';

function seedDevice(): void {
    toasterStore.set({
        [DEVICE_ID]: {
            ...defaultToasterState,
            kit: createDefaultKit(),
        },
    });
}

describe('setStepCondition', () => {
    beforeEach(() => {
        toasterStore.set({});
    });

    it('sets condition on the targeted step', () => {
        seedDevice();
        setStepCondition(DEVICE_ID, 0, 1, 'fill');

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[1];
        expect(step?.condition).toBe('fill');

        setStepCondition(DEVICE_ID, 0, 1, 'first');
        const updatedStep = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[1];
        expect(updatedStep?.condition).toBe('first');
    });

    it('does not resurrect or mutate store when device is missing', () => {
        setStepCondition('missing-device', 0, 0, 'fill');
        expect(toasterStore.value).toEqual({});
    });

    it('no-ops safely when active pattern is missing', () => {
        toasterStore.set({
            [DEVICE_ID]: {
                ...defaultToasterState,
                kit: {
                    ...createDefaultKit(),
                    activePatternId: 'non-existent',
                },
            },
        });

        setStepCondition(DEVICE_ID, 0, 0, 'fill');
        expect(toasterStore.value?.[DEVICE_ID]?.kit.activePatternId).toBe('non-existent');
    });

    it('no-ops safely when pad track is missing', () => {
        seedDevice();
        setStepCondition(DEVICE_ID, 999, 0, 'fill');

        const track0 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0];
        expect(track0?.steps[0]?.condition).toBe('always');
    });

    it('no-ops safely when step index is out of range', () => {
        seedDevice();
        setStepCondition(DEVICE_ID, 0, 999, 'fill');

        const track0 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0];
        expect(track0?.steps[0]?.condition).toBe('always');
    });
});
