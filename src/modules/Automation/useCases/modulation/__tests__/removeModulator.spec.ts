import { describe, it, expect, beforeEach } from 'vitest';

import { modulationStore, modulationRuntimeStore } from '../../../stores/modulationStore';
import { removeModulator } from '../removeModulator';

describe('removeModulator', () => {
    beforeEach(() => {
        modulationStore.set({
            modulators: [
                {
                    id: 'a',
                    name: 'A',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [],
                    enabled: true,
                },
                {
                    id: 'b',
                    name: 'B',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
                    mappings: [],
                    enabled: true,
                },
            ],
        });
        modulationRuntimeStore.set({ runtimeValues: { a: 0.5, b: 0.25 } });
    });

    it('removes the matching modulator and its runtime value', () => {
        removeModulator('a');
        expect(modulationStore.value?.modulators.map((m) => m.id)).toEqual(['b']);
        expect(modulationRuntimeStore.value?.runtimeValues).toEqual({ b: 0.25 });
    });

    it('defers runtime cleanup until project truth commits', () => {
        const finalizeRuntimeEffects = removeModulator('a', { deferRuntimeEffects: true });

        expect(modulationStore.value?.modulators.map((modulator) => modulator.id)).toEqual(['b']);
        expect(modulationRuntimeStore.value?.runtimeValues).toEqual({ a: 0.5, b: 0.25 });

        finalizeRuntimeEffects?.();

        expect(modulationRuntimeStore.value?.runtimeValues).toEqual({ b: 0.25 });
    });

    it('is a no-op when id is unknown', () => {
        removeModulator('zzz');
        expect(modulationStore.value?.modulators).toHaveLength(2);
        expect(modulationRuntimeStore.value?.runtimeValues).toEqual({ a: 0.5, b: 0.25 });
    });

    it('does nothing when the store is empty', () => {
        modulationStore.clear();
        expect(() => removeModulator('a')).not.toThrow();
    });
});
