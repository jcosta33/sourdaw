import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { setNotePressure } from '../setNotePressure';

describe('setNotePressure', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should update pressure value and clamp to 0-127', () => {
        setNotePressure('clip1', 'n1', 80);
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.pressure).toBe(80);

        setNotePressure('clip1', 'n1', 200);
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.pressure).toBe(127);
    });
});
