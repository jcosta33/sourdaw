import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { legatoNotes } from '../legatoNotes';

function note(id: string, pitch: number, startBeat: number, duration: number) {
    return {
        id,
        pitch,
        startBeat,
        duration,
        velocity: 100,
    };
}

describe('legatoNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    note('a', 60, 0, 0.5),
                    note('b', 60, 2, 0.5), // gap of 1.5
                    note('c', 64, 4, 0.5), // different pitch
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should extend note to next note on same pitch', () => {
        legatoNotes('clip1', ['a']);
        const notes = midiStore.value?.notesByClipId.clip1;
        const noteA = notes?.find((node) => node.id === 'a');
        expect(noteA?.duration).toBe(2);
    });

    it('should fallback to next note on any pitch in the clip', () => {
        // 'a' (pitch 60) has no later same-pitch note, so the fallback extends it
        // to the start of the next note on ANY pitch in the clip — here 'c' at
        // beat 4 — even though 'c' is a different pitch (inventory triage #9).
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 0.5), note('c', 64, 4, 0.5)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        legatoNotes('clip1', ['a', 'c']);
        const noteA2 = midiStore.value?.notesByClipId.clip1?.find((node) => node.id === 'a');
        expect(noteA2?.duration).toBe(4);
    });

    it('should not change last note', () => {
        legatoNotes('clip1', ['c']);
        const noteC = midiStore.value?.notesByClipId.clip1?.find((node) => node.id === 'c');
        expect(noteC?.duration).toBe(0.5);
    });

    it('drops a curve point outside the new span when legato shortens a note', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    {
                        id: 'a',
                        pitch: 60,
                        startBeat: 0,
                        duration: 2,
                        velocity: 100,
                        expression: {
                            pressure: [
                                { offsetBeats: 0.5, value: 40 },
                                { offsetBeats: 1.5, value: 90 },
                            ],
                        },
                    },
                    note('b', 60, 1, 0.5),
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        legatoNotes('clip1', ['a']);
        const noteA = midiStore.value?.notesByClipId.clip1?.find((node) => node.id === 'a');
        expect(noteA?.duration).toBe(1);
        expect(noteA?.expression).toEqual({ pressure: [{ offsetBeats: 0.5, value: 40 }] });
    });

    it('should stop the cross-pitch fallback at an unselected note in between', () => {
        // Selected note 'a' has no later same-pitch note. The fallback must extend to
        // the next note on ANY pitch in the clip — including the unselected 'mid' at
        // beat 1 — not skip past it to the selected 'far' at beat 4 (which would
        // overrun 'mid' and distort the voicing).
        midiStore.set({
            notesByClipId: {
                clip1: [
                    note('a', 60, 0, 0.5),
                    note('mid', 67, 1, 0.5), // unselected note in between
                    note('far', 64, 4, 0.5), // selected note further out
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        legatoNotes('clip1', ['a', 'far']);
        const noteA = midiStore.value?.notesByClipId.clip1?.find((node) => node.id === 'a');
        // Extends to the unselected 'mid' at beat 1, not to the selected 'far' at beat 4.
        expect(noteA?.duration).toBe(1);
    });
});
