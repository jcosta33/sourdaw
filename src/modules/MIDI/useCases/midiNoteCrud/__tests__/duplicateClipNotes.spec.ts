import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiNote } from '../../../models/MidiNote';
import { midiStore } from '../../../stores/midiStore';
import { duplicateClipNotes } from '../duplicateClipNotes';

describe('duplicateClipNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should not write when the store is null', () => {
        midiStore.set(null);
        duplicateClipNotes('src', 'dst');
        expect(midiStore.value).toBeNull();
    });

    it('should copy core fields and append to the destination clip', () => {
        midiStore.set({
            notesByClipId: {
                src: [{ id: 's1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                dst: [{ id: 'd1', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        duplicateClipNotes('src', 'dst');

        const dst = midiStore.value?.notesByClipId.dst;
        expect(dst).toHaveLength(2);
        const clone = dst?.find((node) => node.id !== 'd1');
        expect(clone?.pitch).toBe(60);
        expect(clone?.velocity).toBe(90);
    });

    it('should preserve the optional MPE / expression fields on the clone', () => {
        const source: MidiNote = {
            id: 's1',
            pitch: 64,
            startBeat: 2,
            duration: 0.5,
            velocity: 110,
            probability: 50,
            pressure: 0.7,
            slide: -0.25,
            pitchBend: 0.9,
        };
        midiStore.set({
            notesByClipId: { src: [source] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        duplicateClipNotes('src', 'dst');

        const clone = midiStore.value?.notesByClipId.dst?.[0];
        // Regression: these four were silently dropped on duplication.
        expect(clone?.probability).toBe(50);
        expect(clone?.pressure).toBe(0.7);
        expect(clone?.slide).toBe(-0.25);
        expect(clone?.pitchBend).toBe(0.9);
        // The clone is a distinct note (new id).
        expect(clone?.id).not.toBe('s1');
    });

    it('should not invent expression fields the source lacks', () => {
        midiStore.set({
            notesByClipId: {
                src: [{ id: 's1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        duplicateClipNotes('src', 'dst');

        const clone = midiStore.value?.notesByClipId.dst?.[0];
        expect(clone?.pressure).toBeUndefined();
        expect(clone?.slide).toBeUndefined();
        expect(clone?.pitchBend).toBeUndefined();
    });

    it('keeps the legacy clamps and probability default, and carries the MPE channel', () => {
        midiStore.set({
            notesByClipId: {
                src: [{ id: 's1', pitch: 200.4, startBeat: 2, duration: 0, velocity: 0, channel: 8 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        duplicateClipNotes('src', 'dst');

        expect(midiStore.value?.notesByClipId.dst?.[0]).toEqual(
            expect.objectContaining({ pitch: 127, startBeat: 2, duration: 0.0625, velocity: 1, probability: 100 })
        );
        // Per-note channel is MPE routing, not decoration: dropping it on a
        // duplicate silently re-routes the copy to channel 0 (issue #1832 F8).
        expect(midiStore.value?.notesByClipId.dst?.[0]?.channel).toBe(8);
    });
});
