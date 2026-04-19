import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';

import { invertNotes } from '../invertNotes';

const note = (id: string, pitch: number) => ({
    id,
    pitch,
    startBeat: 0,
    duration: 0.25,
    velocity: 100,
});

describe('invertNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60), note('b', 64)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should reflect pitches about the min/max midpoint', () => {
        invertNotes('clip1');
        expect(midiStore.value?.notesByClipId.clip1?.map((n) => n.pitch)).toEqual([64, 60]);
    });

    it('should do nothing when fewer than two notes exist', () => {
        midiStore.set({
            notesByClipId: { clip1: [note('only', 60)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        invertNotes('clip1');
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.pitch).toBe(60);
    });

    it('should not mutate when the clip or store is missing', () => {
        invertNotes('missing');
        midiStore.set(null);
        invertNotes('clip1');
        expect(midiStore.value).toBeNull();
    });
});
