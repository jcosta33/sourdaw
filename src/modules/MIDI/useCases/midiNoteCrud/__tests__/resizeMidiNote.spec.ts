import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { resizeMidiNote } from '../resizeMidiNote';

function note(id: string, startBeat: number, duration: number) {
    return {
        id,
        pitch: 60,
        startBeat,
        duration,
        velocity: 100,
    };
}

describe('resizeMidiNote', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                c1: [note('n1', 0, 1)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should update start and duration when provided', () => {
        resizeMidiNote('c1', 'n1', 2, 0.5);
        const n = midiStore.value?.notesByClipId.c1?.[0];
        expect(n?.startBeat).toBe(2);
        expect(n?.duration).toBe(0.5);
    });

    it('should enforce a minimum duration of 0.0625 beats (64th note, matching addMidiNote)', () => {
        resizeMidiNote('c1', 'n1', undefined, 0.01);
        expect(midiStore.value?.notesByClipId.c1?.[0]?.duration).toBe(0.0625);
    });

    it('should not mutate when the clip or store is missing', () => {
        resizeMidiNote('missing', 'n1', 0, 1);
        midiStore.set(null);
        resizeMidiNote('c1', 'n1', 0, 1);
        expect(midiStore.value).toBeNull();
    });
});
