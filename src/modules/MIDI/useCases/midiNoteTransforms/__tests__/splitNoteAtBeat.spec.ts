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

        const left = notes?.find((node) => node.startBeat === 0);
        const right = notes?.find((node) => node.startBeat === 2);

        expect(left?.duration).toBe(2);
        expect(right?.duration).toBe(2);
        expect(right?.pitch).toBe(60);
        expect(right?.velocity).toBe(100);
        expect(right?.pressure).toBe(50);
        expect(right?.slide).toBe(60);
        expect(right?.pitchBend).toBe(1000);
    });

    it('carries the per-note channel and bend range onto the right half', () => {
        // The right half is built from `createMidiNote` plus an explicit field
        // list, so anything not named there is dropped. The MPE channel is the
        // note's voice routing and the bend range scales its stored pitchBend.
        midiStore.set({
            notesByClipId: {
                clip1: [{ ...note('a', 60, 0, 4), channel: 5, pitchBendRangeSemitones: 48, articulation: 'accent' }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        splitNoteAtBeat('clip1', ['a'], 2);

        const right = midiStore.value?.notesByClipId.clip1?.find((node) => node.startBeat === 2);
        expect(right).toMatchObject({ channel: 5, pitchBendRangeSemitones: 48, articulation: 'accent' });
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
        expect(notes?.some((node) => node.id === 'b' && node.duration === 4)).toBe(true);
    });
});
