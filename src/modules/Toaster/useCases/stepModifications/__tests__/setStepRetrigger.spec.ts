import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultKit } from '../../../models/ToasterKit';
import { defaultToasterState, toasterStore } from '../../../stores/toasterStore';
import { setStepRetrigger } from '../setStepRetrigger';

const DEVICE_ID = 'toaster-retrigger-device';

function seedDevice(): void {
    toasterStore.set({
        [DEVICE_ID]: {
            ...defaultToasterState,
            kit: createDefaultKit(),
        },
    });
}

describe('setStepRetrigger', () => {
    beforeEach(() => {
        toasterStore.set({});
    });

    it('sets retriggerCount on the targeted step', () => {
        seedDevice();
        setStepRetrigger(DEVICE_ID, 0, 1, 3);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[1];
        expect(step?.retriggerCount).toBe(3);
    });

    it('clamps retriggerCount below 0 to 0', () => {
        seedDevice();
        setStepRetrigger(DEVICE_ID, 0, 0, -5);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[0];
        expect(step?.retriggerCount).toBe(0);
    });

    it('clamps retriggerCount above 16 to 16', () => {
        seedDevice();
        setStepRetrigger(DEVICE_ID, 0, 0, 24);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[0];
        expect(step?.retriggerCount).toBe(16);
    });

    it('rounds non-integer retrigger counts', () => {
        seedDevice();
        setStepRetrigger(DEVICE_ID, 0, 0, 2.7);

        const step1 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[0];
        expect(step1?.retriggerCount).toBe(3);

        setStepRetrigger(DEVICE_ID, 0, 0, 1.2);
        const step2 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[0];
        expect(step2?.retriggerCount).toBe(1);
    });

    it('does not resurrect or mutate store when device is missing', () => {
        setStepRetrigger('missing-device', 0, 0, 2);
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

        setStepRetrigger(DEVICE_ID, 0, 0, 2);
        expect(toasterStore.value?.[DEVICE_ID]?.kit.activePatternId).toBe('non-existent');
    });

    it('no-ops safely when pad track is missing', () => {
        seedDevice();
        setStepRetrigger(DEVICE_ID, 999, 0, 2);

        const track0 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0];
        expect(track0?.steps[0]?.retriggerCount).toBe(0);
    });

    it('no-ops safely when step index is out of range', () => {
        seedDevice();
        setStepRetrigger(DEVICE_ID, 0, 999, 2);

        const track0 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0];
        expect(track0?.steps[0]?.retriggerCount).toBe(0);
    });
});
