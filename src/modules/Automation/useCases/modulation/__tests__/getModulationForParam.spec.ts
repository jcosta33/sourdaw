import { describe, it, expect, beforeEach } from 'vitest';

import { modulationStore, modulationRuntimeStore } from '../../../stores/modulationStore';
import { getModulationForParam } from '../getModulationForParam';

describe('getModulationForParam', () => {
    beforeEach(() => {
        modulationStore.set({
            modulators: [
                {
                    id: 'mod1',
                    name: 'Mod 1',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [
                        { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: 0.5 },
                        { targetTrackId: 't2', targetDeviceId: 'd2', targetParamId: 'p2', amount: 1.0 },
                    ],
                    enabled: true,
                },
                {
                    id: 'mod2',
                    name: 'Mod 2',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'p1', amount: -0.2 }],
                    enabled: true,
                },
            ],
        });
        modulationRuntimeStore.set({
            runtimeValues: {
                mod1: 0.8,
                mod2: 0.5,
            },
        });
    });

    it('should aggregate modulation from multiple modulators', () => {
        // mod1: 0.8 * 0.5 = 0.4
        // mod2: 0.5 * -0.2 = -0.1
        // total: 0.3
        const result = getModulationForParam('t1', 'd1', 'p1');
        expect(result).toBeCloseTo(0.3);
    });

    it('should return 0 if no mappings match', () => {
        const result = getModulationForParam('t1', 'd1', 'other');
        expect(result).toBe(0);
    });

    it('should respect enabled flag', () => {
        const state = modulationStore.value!;
        modulationStore.set({
            ...state,
            modulators: state.modulators.map((message) => (message.id === 'mod1' ? { ...message, enabled: false } : message)),
        });
        // only mod2: 0.5 * -0.2 = -0.1
        const result = getModulationForParam('t1', 'd1', 'p1');
        expect(result).toBeCloseTo(-0.1);
    });

    it('should clamp result to -1..1', () => {
        const state = modulationStore.value!;
        modulationRuntimeStore.set({ runtimeValues: { mod1: 1.0, mod2: 1.0 } });
        modulationStore.set({
            ...state,
            modulators: state.modulators.map((message) =>
                message.id === 'mod1' ? { ...message, mappings: [{ ...message.mappings[0]!, amount: 1.0 }] } : message
            ),
        });
        // mod1: 1.0 * 1.0 = 1.0
        // mod2: 1.0 * -0.2 = -0.2
        // total: 0.8 (not clamped)
        expect(getModulationForParam('t1', 'd1', 'p1')).toBeCloseTo(0.8);

        // Make it > 1
        modulationStore.set({
            ...modulationStore.value!,
            modulators: state.modulators.map((message) =>
                message.id === 'mod1' ? { ...message, mappings: [{ ...message.mappings[0]!, amount: 2.0 }] } : message
            ),
        });
        expect(getModulationForParam('t1', 'd1', 'p1')).toBe(1);
    });
});
