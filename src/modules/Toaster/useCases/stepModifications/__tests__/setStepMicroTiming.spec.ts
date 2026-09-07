import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultKit } from '../../../models/ToasterKit';
import { defaultToasterState, toasterStore } from '../../../stores/toasterStore';
import { setStepMicroTiming } from '../setStepMicroTiming';

const DEVICE_ID = 'toaster-microtiming-device';

function seedDevice(): void {
    toasterStore.set({
        [DEVICE_ID]: {
            ...defaultToasterState,
            kit: createDefaultKit(),
        },
    });
}

describe('setStepMicroTiming', () => {
    beforeEach(() => {
        toasterStore.set({});
    });

    it('sets positive microTiming on the targeted step', () => {
        seedDevice();
        setStepMicroTiming(DEVICE_ID, 0, 1, 0.25);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[1];
        expect(step?.microTiming).toBe(0.25);
    });

    it('sets negative microTiming on the targeted step', () => {
        seedDevice();
        setStepMicroTiming(DEVICE_ID, 0, 1, -0.25);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[1];
        expect(step?.microTiming).toBe(-0.25);
    });

    it('clamps microTiming below -0.5 to -0.5', () => {
        seedDevice();
        setStepMicroTiming(DEVICE_ID, 0, 0, -0.8);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[0];
        expect(step?.microTiming).toBe(-0.5);
    });

    it('clamps microTiming above 0.5 to 0.5', () => {
        seedDevice();
        setStepMicroTiming(DEVICE_ID, 0, 0, 0.9);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[0];
        expect(step?.microTiming).toBe(0.5);
    });

    it('does not resurrect or mutate store when device is missing', () => {
        setStepMicroTiming('missing-device', 0, 0, 0.2);
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

        setStepMicroTiming(DEVICE_ID, 0, 0, 0.2);
        expect(toasterStore.value?.[DEVICE_ID]?.kit.activePatternId).toBe('non-existent');
    });

    it('no-ops safely when pad track is missing', () => {
        seedDevice();
        setStepMicroTiming(DEVICE_ID, 999, 0, 0.2);

        const track0 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0];
        expect(track0?.steps[0]?.microTiming).toBe(0);
    });

    it('no-ops safely when step index is out of range', () => {
        seedDevice();
        setStepMicroTiming(DEVICE_ID, 0, 999, 0.2);

        const track0 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0];
        expect(track0?.steps[0]?.microTiming).toBe(0);
    });
});
