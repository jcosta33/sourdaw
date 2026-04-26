import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { addMidiNote } from '../addMidiNote';

describe('addMidiNote', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should append a clamped note and return it', () => {
        const node = addMidiNote('c1', 300, -2, 0.01, 0);
        expect(node.pitch).toBe(127);
        expect(node.startBeat).toBe(0);
        expect(node.duration).toBeGreaterThanOrEqual(0.0625);
        expect(node.velocity).toBe(1);
        expect(midiStore.value?.notesByClipId.c1).toHaveLength(1);
    });

    it('should throw when the MIDI store is not initialized', () => {
        midiStore.set(null);
        expect(() => addMidiNote('c1', 60, 0, 0.25)).toThrow();
    });
});
