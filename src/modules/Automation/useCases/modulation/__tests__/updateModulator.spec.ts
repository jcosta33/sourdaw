import { describe, it, expect, beforeEach } from 'vitest';

import { modulationStore } from '../../../stores/modulationStore';
import { updateModulator, type ModulatorPatch } from '../updateModulator';

describe('updateModulator', () => {
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
            ],
        });
    });

    it('applies a partial patch to the matching modulator', () => {
        updateModulator('a', { name: 'Renamed', enabled: false });
        const mod = modulationStore.value?.modulators[0];
        expect(mod?.name).toBe('Renamed');
        expect(mod?.enabled).toBe(false);
        expect(mod?.id).toBe('a');
    });

    it('never allows the id to be overwritten', () => {
        // Simulate an untyped (JS / cast) caller smuggling an id through the patch.
        updateModulator('a', { id: 'hacker', name: 'Renamed' } as ModulatorPatch);
        expect(modulationStore.value?.modulators[0]?.id).toBe('a');
    });

    it('refuses an empty trackId patch like addModulator refuses an empty trackId', () => {
        expect(() => updateModulator('a', { trackId: '' })).toThrowError('updateModulator: trackId must not be empty');
        expect(modulationStore.value?.modulators[0]?.trackId).toBe('t1');
    });

    it('moves a modulator to another track through the patch', () => {
        updateModulator('a', { trackId: 't2' });
        expect(modulationStore.value?.modulators[0]?.trackId).toBe('t2');
    });

    it('is a no-op when the id is unknown', () => {
        updateModulator('zzz', { name: 'X' });
        expect(modulationStore.value?.modulators[0]?.name).toBe('A');
    });

    it('does nothing when the store is empty', () => {
        modulationStore.clear();
        expect(() => updateModulator('a', { name: 'X' })).not.toThrow();
    });
});
