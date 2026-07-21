import { describe, it, expect, beforeEach } from 'vitest';

import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '../../stores/midiStore';
import { getMidiStoreState } from '../getMidiStoreState';

describe('getMidiStoreState', () => {
    beforeEach(() => {
        midiStore.set({
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should return the current MIDI store snapshot', () => {
        const next = {
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        midiStore.set(next);
        expect(getMidiStoreState()).toBe(next);
    });

    it('should return null when the store is not initialized', () => {
        midiStore.set(null);
        expect(getMidiStoreState()).toBeNull();
    });
});
