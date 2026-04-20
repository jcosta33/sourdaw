import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setNotePitchBend } from '../setNotePitchBend';
import { midiStore } from '../../../stores/midiStore';

describe('setNotePitchBend', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }
                ]
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should update pitchBend value and clamp to MIDI range', () => {
        setNotePitchBend('clip1', 'n1', 1000);
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.pitchBend).toBe(1000);

        setNotePitchBend('clip1', 'n1', 99999);
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.pitchBend).toBe(8191);

        setNotePitchBend('clip1', 'n1', -99999);
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.pitchBend).toBe(-8192);
    });
});
