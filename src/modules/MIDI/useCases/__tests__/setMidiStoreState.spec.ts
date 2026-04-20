import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../stores/midiStore';
import { getMidiStoreState } from '../getMidiStoreState';
import { setMidiStoreState } from '../setMidiStoreState';

describe('setMidiStoreState', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should replace the MIDI store with the given state', () => {
        const next = {
            notesByClipId: {
                clip: [{ id: 'a', pitch: 48, startBeat: 0, duration: 0.25, velocity: 80 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        setMidiStoreState(next);
        expect(getMidiStoreState()).toBe(next);
    });
});
