import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { joinNotes } from '../joinNotes';

const note = (id: string, pitch: number, startBeat: number, duration: number) => ({
    id,
    pitch,
    startBeat,
    duration,
    velocity: 100,
});

describe('joinNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    note('a', 60, 0, 1),
                    note('b', 60, 1, 1),
                    note('c', 60, 3, 1), // gap
                    note('d', 64, 0, 1), // different pitch
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should merge adjacent same-pitch selected notes', () => {
        joinNotes('clip1', ['a', 'b']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(3);
        const joined = notes?.find((n) => n.startBeat === 0 && n.pitch === 60);
        expect(joined?.duration).toBe(2);
        expect(notes?.find((n) => n.id === 'c')).toBeDefined();
        expect(notes?.find((n) => n.id === 'd')).toBeDefined();
    });

    it('should not merge non-adjacent notes', () => {
        joinNotes('clip1', ['a', 'c']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(4);
    });

    it('should not merge notes with different pitches', () => {
        joinNotes('clip1', ['a', 'd']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(4);
    });

    it('should merge multiple adjacent notes into one', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 1), note('b', 60, 1, 1), note('c', 60, 2, 1)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b', 'c']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(1);
        expect(notes?.[0]?.duration).toBe(3);
    });
});
