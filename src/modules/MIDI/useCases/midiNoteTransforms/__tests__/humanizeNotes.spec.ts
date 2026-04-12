import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores/midiStore';

import { humanizeNotes } from '../humanizeNotes';

const note = (id: string) => ({
    id,
    pitch: 60,
    startBeat: 0,
    duration: 0.25,
    velocity: 100,
});

describe('humanizeNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: { clip1: [note('a')] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should return zero when the store or clip is missing', () => {
        expect(humanizeNotes('missing', 1)).toBe(0);
        midiStore.set(null);
        expect(humanizeNotes('clip1', 1)).toBe(0);
    });

    it('should return the provided seed when a seed is passed', () => {
        const seed = humanizeNotes('clip1', 0, 0, 999);
        expect(seed).toBe(999);
    });

    it('should return a numeric seed when none is provided', () => {
        const seed = humanizeNotes('clip1', 0, 0);
        expect(Number.isFinite(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
    });
});
