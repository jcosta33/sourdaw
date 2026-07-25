import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { chordTrackStore } from '../../stores/chordTrackStore';
import {
    isValidMidiProbabilitySeed,
    LEGACY_MIDI_PROBABILITY_SEED,
    midiStore,
    type MidiStoreState,
} from '../../stores/midiStore';
import { resetMidiStoreForProject } from '../resetMidiStoreForProject';

describe('resetMidiStoreForProject', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('generates one unsigned u32 seed for a new project', () => {
        const getRandomValues = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
            if (array instanceof Uint32Array) {
                array[0] = 3_735_928_559;
            }
            return array;
        });

        resetMidiStoreForProject({ generateProbabilitySeed: true });

        expect(getRandomValues).toHaveBeenCalledTimes(1);
        expect(midiStore.value).toEqual({
            probabilitySeed: 3_735_928_559,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const state = midiStore.value;
        if (state === null) {
            throw new Error('Expected reset MIDI store state');
        }
        expectTypeOf(state).toEqualTypeOf<MidiStoreState>();
        expectTypeOf(state.probabilitySeed).toEqualTypeOf<number>();
        expect(isValidMidiProbabilitySeed(state.probabilitySeed)).toBe(true);
    });

    it('uses one deterministic seed when a legacy project has none', () => {
        const getRandomValues = vi.spyOn(crypto, 'getRandomValues');
        const hydrate = vi.spyOn(chordTrackStore, 'hydrate');
        const set = vi.spyOn(chordTrackStore, 'set');

        resetMidiStoreForProject();

        expect(getRandomValues).not.toHaveBeenCalled();
        expect(midiStore.value?.probabilitySeed).toBe(LEGACY_MIDI_PROBABILITY_SEED);
        expect(hydrate).toHaveBeenCalledTimes(1);
        expect(set).not.toHaveBeenCalled();
    });
});
