import { describe, it, expect, beforeEach } from 'vitest';

import { modulationStore, modulationRuntimeStore } from '../../../stores/modulationStore';
import { applyModulation } from '../applyModulation';

describe('applyModulation', () => {
    beforeEach(() => {
        modulationStore.set({
            modulators: [
                {
                    id: 'lfo1',
                    name: 'LFO 1',
                    trackId: 't1',
                    kind: 'lfo',
                    config: {
                        kind: 'lfo',
                        waveform: 'sine',
                        rate: 4, // 1 bar
                        sync: true,
                        phase: 0,
                        depth: 1,
                    },
                    mappings: [],
                    enabled: true,
                },
                {
                    id: 'step1',
                    name: 'Step 1',
                    trackId: 't1',
                    kind: 'step',
                    config: {
                        kind: 'step',
                        steps: [0, 1, 0.5],
                        rate: 1,
                        smooth: 0,
                    },
                    mappings: [],
                    enabled: true,
                },
            ],
        });
        modulationRuntimeStore.set({
            runtimeValues: {},
        });
    });

    it('should compute sine LFO values correctly', () => {
        // At beat 0, sin(0) = 0, (0+1)/2 = 0.5
        applyModulation(0);
        expect(modulationRuntimeStore.value?.runtimeValues.lfo1).toBeCloseTo(0.5);

        // At beat 1 (1/4 of cycle), sin(pi/2) = 1, (1+1)/2 = 1
        applyModulation(1);
        expect(modulationRuntimeStore.value?.runtimeValues.lfo1).toBeCloseTo(1);

        // At beat 2 (1/2 of cycle), sin(pi) = 0, (0+1)/2 = 0.5
        applyModulation(2);
        expect(modulationRuntimeStore.value?.runtimeValues.lfo1).toBeCloseTo(0.5);

        // At beat 3 (3/4 of cycle), sin(3pi/2) = -1, (-1+1)/2 = 0
        applyModulation(3);
        expect(modulationRuntimeStore.value?.runtimeValues.lfo1).toBeCloseTo(0);
    });

    it('should compute step modulator values correctly', () => {
        applyModulation(0.5); // step 0
        expect(modulationRuntimeStore.value?.runtimeValues.step1).toBe(0);

        applyModulation(1.5); // step 1
        expect(modulationRuntimeStore.value?.runtimeValues.step1).toBe(1);

        applyModulation(2.5); // step 2
        expect(modulationRuntimeStore.value?.runtimeValues.step1).toBe(0.5);

        applyModulation(3.5); // wraps to step 0
        expect(modulationRuntimeStore.value?.runtimeValues.step1).toBe(0);
    });

    it('should not update if modulator is disabled', () => {
        const state = modulationStore.value!;
        modulationStore.set({
            ...state,
            modulators: state.modulators.map((m) => ({ ...m, enabled: false })),
        });

        applyModulation(1);
        expect(modulationRuntimeStore.value?.runtimeValues).toEqual({});
    });
});
