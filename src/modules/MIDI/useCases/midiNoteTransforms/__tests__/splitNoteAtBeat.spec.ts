import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { splitNoteAtBeat } from '../splitNoteAtBeat';

function note(id: string, pitch: number, startBeat: number, duration: number) {
    return {
        id,
        pitch,
        startBeat,
        duration,
        velocity: 100,
        pressure: 50,
        slide: 60,
        pitchBend: 1000,
    };
}

describe('splitNoteAtBeat', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 4)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should split selected note spanning the beat', () => {
        splitNoteAtBeat('clip1', ['a'], 2);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(2);

        const left = notes?.find((n) => n.startBeat === 0);
        const right = notes?.find((n) => n.startBeat === 2);

        expect(left?.duration).toBe(2);
        expect(right?.duration).toBe(2);
        expect(right?.pitch).toBe(60);
        expect(right?.velocity).toBe(100);
        expect(right?.pressure).toBe(50);
        expect(right?.slide).toBe(60);
        expect(right?.pitchBend).toBe(1000);
    });

    it('should not split note if beat is outside', () => {
        splitNoteAtBeat('clip1', ['a'], 5);
        expect(midiStore.value?.notesByClipId.clip1?.length).toBe(1);

        splitNoteAtBeat('clip1', ['a'], 0);
        expect(midiStore.value?.notesByClipId.clip1?.length).toBe(1);
    });

    it('should only split selected notes', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 4), note('b', 64, 0, 4)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        splitNoteAtBeat('clip1', ['a'], 2);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(3);
        expect(notes?.some((n) => n.id === 'b' && n.duration === 4)).toBe(true);
    });
});
