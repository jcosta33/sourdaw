import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../stores/midiStore';
import { getMidiStoreState } from '../getMidiStoreState';

describe('getMidiStoreState', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should return the current MIDI store snapshot', () => {
        const next = {
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
