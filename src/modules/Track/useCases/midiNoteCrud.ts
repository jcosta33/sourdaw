import { midiStore } from '../stores/midiStore';
import { createMidiNote, type MidiNote } from '../models/MidiNote';

export function addMidiNote(
    clipId: string,
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100
): MidiNote {
    const state = midiStore.value;
    if (!state) {
        throw new Error('MIDI store not initialized');
    }

    const note = createMidiNote(pitch, startBeat, duration, velocity);
    const existing = state.notesByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, note],
        },
    });

    return note;
}

export function removeMidiNote(clipId: string, noteId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.filter((n) => n.id !== noteId),
        },
    });
}

export function moveMidiNote(clipId: string, noteId: string, newPitch: number, newStartBeat: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => (n.id === noteId ? { ...n, pitch: newPitch, startBeat: newStartBeat } : n)),
        },
    });
}

export function setNoteVelocity(clipId: string, noteId: string, velocity: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) =>
                n.id === noteId ? { ...n, velocity: Math.max(0, Math.min(127, velocity)) } : n
            ),
        },
    });
}

export function getNotesForClip(clipId: string): MidiNote[] {
    const state = midiStore.value;
    if (!state) {
        return [];
    }
    return state.notesByClipId[clipId] ?? [];
}

export function duplicateNotes(clipId: string, noteIds: string[]): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    const toDuplicate = existing.filter((n) => noteIds.includes(n.id));
    if (toDuplicate.length === 0) {
        return;
    }

    const maxEnd = Math.max(...toDuplicate.map((n) => n.startBeat + n.duration));
    const minStart = Math.min(...toDuplicate.map((n) => n.startBeat));
    const offset = maxEnd - minStart;

    const newNotes = toDuplicate.map((n) => createMidiNote(n.pitch, n.startBeat + offset, n.duration, n.velocity));

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, ...newNotes],
        },
    });
}
