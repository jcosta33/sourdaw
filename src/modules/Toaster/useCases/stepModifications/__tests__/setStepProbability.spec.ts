import { beforeEach, describe, expect, it } from 'vitest';

import { createDefaultKit } from '../../../models/ToasterKit';
import { defaultToasterState, toasterStore } from '../../../stores/toasterStore';
import { setStepProbability } from '../setStepProbability';

const DEVICE_ID = 'toaster-probability-device';

function seedDevice(): void {
    toasterStore.set({
        [DEVICE_ID]: {
            ...defaultToasterState,
            kit: createDefaultKit(),
        },
    });
}

describe('setStepProbability', () => {
    beforeEach(() => {
        toasterStore.set({});
    });

    it('sets probability on the targeted step', () => {
        seedDevice();
        setStepProbability(DEVICE_ID, 0, 1, 0.75);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[1];
        expect(step?.probability).toBe(0.75);
    });

    it('clamps probability below 0 to 0', () => {
        seedDevice();
        setStepProbability(DEVICE_ID, 0, 0, -0.5);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[0];
        expect(step?.probability).toBe(0);
    });

    it('clamps probability above 1 to 1', () => {
        seedDevice();
        setStepProbability(DEVICE_ID, 0, 0, 1.5);

        const step = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0]?.steps[0];
        expect(step?.probability).toBe(1);
    });

    it('does not resurrect or mutate store when device is missing', () => {
        setStepProbability('missing-device', 0, 0, 0.5);
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

        setStepProbability(DEVICE_ID, 0, 0, 0.5);
        expect(toasterStore.value?.[DEVICE_ID]?.kit.activePatternId).toBe('non-existent');
    });

    it('no-ops safely when pad track is missing', () => {
        seedDevice();
        setStepProbability(DEVICE_ID, 999, 0, 0.5);

        const track0 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0];
        expect(track0?.steps[0]?.probability).toBe(1);
    });

    it('no-ops safely when step index is out of range', () => {
        seedDevice();
        setStepProbability(DEVICE_ID, 0, 999, 0.5);

        const track0 = toasterStore.value?.[DEVICE_ID]?.kit.patterns[0]?.tracks[0];
        expect(track0?.steps[0]?.probability).toBe(1);
    });
});
