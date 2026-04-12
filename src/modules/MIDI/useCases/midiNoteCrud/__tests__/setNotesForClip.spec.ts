import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores/midiStore';

import { setNotesForClip } from '../setNotesForClip';

const note = (id: string): { id: string; pitch: number; startBeat: number; duration: number; velocity: number } => ({
    id,
    pitch: 60,
    startBeat: 0,
    duration: 0.25,
    velocity: 100,
});

describe('setNotesForClip', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: { c1: [note('old')] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should replace the clip note list with the provided array', () => {
        const next = [note('a'), note('b')];
        setNotesForClip('c1', next);
        expect(midiStore.value?.notesByClipId.c1).toEqual(next);
    });

    it('should not mutate when the store is null', () => {
        midiStore.set(null);
        setNotesForClip('c1', [note('x')]);
        expect(midiStore.value).toBeNull();
    });
});
