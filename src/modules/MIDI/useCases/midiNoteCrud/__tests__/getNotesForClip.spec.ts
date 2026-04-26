import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { getNotesForClip } from '../getNotesForClip';

function n(id: string): { id: string; pitch: number; startBeat: number; duration: number; velocity: number } {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 0.25,
        velocity: 100,
    };
}

describe('getNotesForClip', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: { c1: [n('a'), n('b')] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should return notes for the clip or an empty array when missing', () => {
        expect(getNotesForClip('c1')).toHaveLength(2);
        expect(getNotesForClip('missing')).toEqual([]);
    });

    it('should return an empty array when the MIDI store is not initialized', () => {
        midiStore.set(null);
        expect(getNotesForClip('c1')).toEqual([]);
    });
});
