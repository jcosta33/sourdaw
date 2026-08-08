import { afterEach, describe, expect, it } from 'vitest';

import { clipboardStore, setClipClipboard, setNoteClipboard, type ClipboardEntry } from '../clipboardStore';

function makeClipEntry(id: string, trackId: string): ClipboardEntry {
    return {
        clip: {
            id,
            trackId,
            name: id,
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
            color: '#fff',
            muted: false,
            gain: 1,
            locked: false,
            midiNotes: [],
            audioBufferId: undefined,
            audioOffsetBeats: 0,
            stretchRatio: 1,
            loopEnabled: false,
            loopLength: undefined,
            midiOffsetBeats: 0,
            fadeInBeats: 0,
            fadeOutBeats: 0,
        } as ClipboardEntry['clip'],
        sourceTrackId: trackId,
    };
}

describe('clipboardStore', () => {
    afterEach(() => {
        // Reset to the initial empty state between tests.
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
    });

    it('starts with an empty clip clipboard and null note clipboard', () => {
        const state = clipboardStore.value;

        expect(state?.clipClipboard).toEqual([]);
        expect(state?.noteClipboard).toBeNull();
    });

    it('setClipClipboard replaces the clip entries', () => {
        const entries = [makeClipEntry('clip-1', 'track-1'), makeClipEntry('clip-2', 'track-1')];

        setClipClipboard(entries);

        expect(clipboardStore.value?.clipClipboard).toHaveLength(2);
        expect(clipboardStore.value?.clipClipboard?.[0]?.clip.id).toBe('clip-1');
        expect(clipboardStore.value?.clipClipboard?.[1]?.clip.id).toBe('clip-2');
    });

    it('setClipClipboard preserves the existing note clipboard (cross-field invariant)', () => {
        setNoteClipboard({ notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] });

        setClipClipboard([makeClipEntry('clip-1', 'track-1')]);

        // The note clipboard must survive the clip clipboard update.
        expect(clipboardStore.value?.noteClipboard?.notes).toHaveLength(1);
        expect(clipboardStore.value?.noteClipboard?.notes[0]?.pitch).toBe(60);
    });

    it('setNoteClipboard replaces the note entry', () => {
        setNoteClipboard({ notes: [{ id: 'n1', pitch: 64, startBeat: 2, duration: 0.5, velocity: 80 }] });

        expect(clipboardStore.value?.noteClipboard?.notes).toHaveLength(1);
        expect(clipboardStore.value?.noteClipboard?.notes[0]?.pitch).toBe(64);
    });

    it('setNoteClipboard preserves the existing clip clipboard (cross-field invariant)', () => {
        setClipClipboard([makeClipEntry('clip-1', 'track-1'), makeClipEntry('clip-2', 'track-2')]);

        setNoteClipboard({ notes: [] });

        // The clip clipboard must survive the note clipboard update.
        expect(clipboardStore.value?.clipClipboard).toHaveLength(2);
        expect(clipboardStore.value?.clipClipboard?.[0]?.sourceTrackId).toBe('track-1');
    });

    it('setNoteClipboard(null) clears the note clipboard but preserves clips', () => {
        setClipClipboard([makeClipEntry('clip-1', 'track-1')]);
        setNoteClipboard({ notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] });

        setNoteClipboard(null);

        expect(clipboardStore.value?.noteClipboard).toBeNull();
        expect(clipboardStore.value?.clipClipboard).toHaveLength(1);
    });

    it('setting clip clipboard to empty array clears clips but preserves notes', () => {
        setClipClipboard([makeClipEntry('clip-1', 'track-1')]);
        setNoteClipboard({ notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] });

        setClipClipboard([]);

        expect(clipboardStore.value?.clipClipboard).toEqual([]);
        expect(clipboardStore.value?.noteClipboard?.notes).toHaveLength(1);
    });
});
