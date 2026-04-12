import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores/midiStore';

import { quantizeNoteLengths } from '../quantizeNoteLengths';

const note = (id: string, duration: number) => ({
    id,
    pitch: 60,
    startBeat: 0,
    duration,
    velocity: 100,
});

describe('quantizeNoteLengths', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 0.11), note('b', 0.4)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should quantize durations to the grid with a minimum of gridSize', () => {
        quantizeNoteLengths('clip1', 0.25);
        expect(midiStore.value?.notesByClipId.clip1?.map((n) => n.duration)).toEqual([0.25, 0.5]);
    });

    it('should not run when the clip is empty or missing', () => {
        quantizeNoteLengths('missing', 0.25);
        midiStore.set({
            notesByClipId: { empty: [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNoteLengths('empty', 0.25);
        expect(midiStore.value?.notesByClipId.empty).toEqual([]);
    });

    it('should not mutate when the store is null', () => {
        midiStore.set(null);
        quantizeNoteLengths('clip1', 0.25);
        expect(midiStore.value).toBeNull();
    });
});
