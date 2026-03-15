import { midiStore } from "../stores/midiStore";
import { createMidiNote, type MidiNote } from "../models/MidiNote";

export const addMidiNote = (
    clipId: string,
    pitch: number,
    startBeat: number,
    duration: number,
    velocity = 100,
): MidiNote => {
    const state = midiStore.value;
    if (!state) throw new Error("MIDI store not initialized");

    const note = createMidiNote(pitch, startBeat, duration, velocity);
    const existing = state.notesByClipId[clipId] ?? [];

    midiStore.set({
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, note],
        },
    });

    return note;
};

export const removeMidiNote = (clipId: string, noteId: string): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.filter((n) => n.id !== noteId),
        },
    });
};

export const moveMidiNote = (
    clipId: string,
    noteId: string,
    newPitch: number,
    newStartBeat: number,
): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) =>
                n.id === noteId ? { ...n, pitch: newPitch, startBeat: newStartBeat } : n,
            ),
        },
    });
};

export const setNoteVelocity = (clipId: string, noteId: string, velocity: number): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) =>
                n.id === noteId ? { ...n, velocity: Math.max(0, Math.min(127, velocity)) } : n,
            ),
        },
    });
};

export const quantizeNotes = (clipId: string, gridSize: number): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: Math.round(n.startBeat / gridSize) * gridSize,
            })),
        },
    });
};

export const transposeNotes = (clipId: string, semitones: number): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                pitch: Math.max(0, Math.min(127, n.pitch + semitones)),
            })),
        },
    });
};

export const humanizeNotes = (clipId: string, amount: number): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: n.startBeat + (Math.random() - 0.5) * amount * 0.25,
                velocity: Math.max(1, Math.min(127, n.velocity + Math.round((Math.random() - 0.5) * amount * 10))),
            })),
        },
    });
};

export const getNotesForClip = (clipId: string): MidiNote[] => {
    const state = midiStore.value;
    if (!state) return [];
    return state.notesByClipId[clipId] ?? [];
};
