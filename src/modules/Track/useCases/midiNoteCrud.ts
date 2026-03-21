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

export function setNoteProbability(clipId: string, noteId: string, probability: number): void {
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
                n.id === noteId ? { ...n, probability: Math.max(0, Math.min(100, probability)) } : n
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

/**
 * Shifts all MIDI data (notes, CCs, pitch bends) for a clip by a beat delta.
 * Called when a clip is moved so MIDI positions stay in sync with the clip.
 */
export function shiftClipMidiNotes(clipId: string, beatDelta: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const notes = state.notesByClipId[clipId];
    const ccs = state.ccByClipId[clipId];
    const pbs = state.pitchBendByClipId[clipId];

    if (!notes && !ccs && !pbs) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: notes
            ? { ...state.notesByClipId, [clipId]: notes.map((n) => ({ ...n, startBeat: n.startBeat + beatDelta })) }
            : state.notesByClipId,
        ccByClipId: ccs
            ? { ...state.ccByClipId, [clipId]: ccs.map((c) => ({ ...c, beat: c.beat + beatDelta })) }
            : state.ccByClipId,
        pitchBendByClipId: pbs
            ? { ...state.pitchBendByClipId, [clipId]: pbs.map((p) => ({ ...p, beat: p.beat + beatDelta })) }
            : state.pitchBendByClipId,
    });
}

export function setNotesForClip(clipId: string, notes: MidiNote[]): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: notes,
        },
    });
}
