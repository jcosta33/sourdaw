import { describe, it, expect, beforeEach } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { addModulator } from '../addModulator';

describe('addModulator', () => {
    beforeEach(() => {
        modulationStore.set({ modulators: [] });
    });

    it('returns a new id and appends the modulator', () => {
        const id = addModulator({
            name: 'LFO 1',
            trackId: 't1',
            kind: 'lfo',
            config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
            mappings: [],
            enabled: true,
        });

        expect(id).toMatch(/^mod-lfo-/);
        const state = modulationStore.value;
        expect(state?.modulators).toHaveLength(1);
        expect(state?.modulators[0]).toMatchObject({ id, name: 'LFO 1', trackId: 't1', kind: 'lfo' });
    });

    it('preserves existing modulators when appending', () => {
        addModulator({
            name: 'A',
            trackId: 't1',
            kind: 'lfo',
            config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: true, phase: 0, depth: 1 },
            mappings: [],
            enabled: true,
        });
        const secondId = addModulator({
            name: 'B',
            trackId: 't1',
            kind: 'step',
            config: { kind: 'step', steps: [0, 1], rate: 1, smooth: 0 },
            mappings: [],
            enabled: true,
        });

        const state = modulationStore.value;
        expect(state?.modulators.map((m) => m.name)).toEqual(['A', 'B']);
        expect(secondId).toMatch(/^mod-step-/);
    });

    it('seeds an empty store when value is null', () => {
        modulationStore.clear();
        const id = addModulator({
            name: 'Env',
            trackId: 't1',
            kind: 'envelope',
            config: { kind: 'envelope', attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3, triggerMode: 'midi' },
            mappings: [],
            enabled: true,
        });

        expect(modulationStore.value?.modulators).toHaveLength(1);
        expect(modulationStore.value?.modulators[0]?.id).toBe(id);
    });
});
