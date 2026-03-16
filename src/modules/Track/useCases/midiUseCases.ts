import { midiStore } from "../stores/midiStore";
import { createMidiNote, createMidiCC, createMidiPitchBend, type MidiNote, type MidiCC, type MidiPitchBend } from "../models/MidiNote";

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
        ...state,
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
        ...state,
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
        ...state,
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
        ...state,
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
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: Math.round(n.startBeat / gridSize) * gridSize,
            })),
        },
    });
};

export const quantizeNoteLengths = (clipId: string, gridSize: number): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) return;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                duration: Math.max(gridSize, Math.round(n.duration / gridSize) * gridSize),
            })),
        },
    });
};

export const quantizeNotesAndLengths = (clipId: string, gridSize: number): void => {
    quantizeNotes(clipId, gridSize);
    quantizeNoteLengths(clipId, gridSize);
};

export const transposeNotes = (clipId: string, semitones: number): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        ...state,
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
        ...state,
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

export const duplicateNotes = (clipId: string, noteIds: string[]): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing) return;

    const toDuplicate = existing.filter((n) => noteIds.includes(n.id));
    if (toDuplicate.length === 0) return;

    const maxEnd = Math.max(...toDuplicate.map((n) => n.startBeat + n.duration));
    const minStart = Math.min(...toDuplicate.map((n) => n.startBeat));
    const offset = maxEnd - minStart;

    const newNotes = toDuplicate.map((n) =>
        createMidiNote(n.pitch, n.startBeat + offset, n.duration, n.velocity),
    );

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, ...newNotes],
        },
    });
};

export const invertNotes = (clipId: string): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length < 2) return;

    const pitches = existing.map((n) => n.pitch);
    const minPitch = Math.min(...pitches);
    const maxPitch = Math.max(...pitches);
    const axis = minPitch + maxPitch;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                pitch: Math.max(0, Math.min(127, axis - n.pitch)),
            })),
        },
    });
};

export const retrogradeNotes = (clipId: string): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length < 2) return;

    const starts = existing.map((n) => n.startBeat);
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...existing.map((n) => n.startBeat + n.duration));
    const totalLength = maxEnd - minStart;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: minStart + totalLength - (n.startBeat - minStart) - n.duration,
            })),
        },
    });
};

export type VelocityCurve = "linear" | "exponential" | "logarithmic" | "s-curve" | "compress" | "expand";

const applyVelocityCurve = (normalized: number, curve: VelocityCurve): number => {
    switch (curve) {
        case "linear": return normalized;
        case "exponential": return normalized * normalized;
        case "logarithmic": return Math.sqrt(normalized);
        case "s-curve": {
            if (normalized < 0.5) {
                return 2 * normalized * normalized;
            }
            return 1 - 2 * (1 - normalized) * (1 - normalized);
        }
        case "compress": return 0.3 + normalized * 0.4;
        case "expand": {
            if (normalized < 0.5) {
                return normalized * 0.3;
            }
            return 0.7 + (normalized - 0.5) * 1.4;
        }
    }
};

export const scaleVelocities = (
    clipId: string,
    curve: VelocityCurve,
    minVelocity = 1,
    maxVelocity = 127,
): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) return;

    const velocities = existing.map((n) => n.velocity);
    const currentMin = Math.min(...velocities);
    const currentMax = Math.max(...velocities);
    const range = currentMax - currentMin || 1;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => {
                const normalized = (n.velocity - currentMin) / range;
                const curved = applyVelocityCurve(normalized, curve);
                const newVelocity = Math.round(minVelocity + curved * (maxVelocity - minVelocity));
                return {
                    ...n,
                    velocity: Math.max(1, Math.min(127, newVelocity)),
                };
            }),
        },
    });
};

export const scaleAllVelocities = (clipId: string, factor: number): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) return;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                velocity: Math.max(1, Math.min(127, Math.round(n.velocity * factor))),
            })),
        },
    });
};

export const setAllVelocities = (clipId: string, velocity: number): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) return;

    const clamped = Math.max(1, Math.min(127, velocity));

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                velocity: clamped,
            })),
        },
    });
};

export const addMidiCC = (
    clipId: string,
    controller: number,
    value: number,
    beat: number,
    channel = 0,
): MidiCC => {
    const state = midiStore.value;
    if (!state) throw new Error("MIDI store not initialized");

    const cc = createMidiCC(controller, value, beat, channel);
    const existing = state.ccByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: [...existing, cc],
        },
    });

    return cc;
};

export const removeMidiCC = (clipId: string, ccId: string): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.ccByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: existing.filter((c) => c.id !== ccId),
        },
    });
};

export const moveMidiCC = (
    clipId: string,
    ccId: string,
    newBeat: number,
    newValue: number,
): void => {
    const state = midiStore.value;
    if (!state) return;

    const existing = state.ccByClipId[clipId];
    if (!existing) return;

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: existing.map((c) =>
                c.id === ccId
                    ? { ...c, beat: Math.max(0, newBeat), value: Math.max(0, Math.min(127, newValue)) }
                    : c,
            ),
        },
    });
};

export const addPitchBend = (
    clipId: string,
    value: number,
    beat: number,
    channel = 0,
): MidiPitchBend => {
    const state = midiStore.value;
    if (!state) {
        throw new Error("MIDI store not initialized");
    }

    const pb = createMidiPitchBend(value, beat, channel);
    const existing = state.pitchBendByClipId[clipId] ?? [];

    midiStore.set({
        ...state,
        pitchBendByClipId: {
            ...state.pitchBendByClipId,
            [clipId]: [...existing, pb],
        },
    });

    return pb;
};

export const removePitchBend = (clipId: string, pbId: string): void => {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.pitchBendByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        pitchBendByClipId: {
            ...state.pitchBendByClipId,
            [clipId]: existing.filter((pb) => pb.id !== pbId),
        },
    });
};

export const setNotePressure = (clipId: string, noteId: string, pressure: number): void => {
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
                n.id === noteId ? { ...n, pressure: Math.max(0, Math.min(127, pressure)) } : n,
            ),
        },
    });
};

export const setNoteSlide = (clipId: string, noteId: string, slide: number): void => {
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
                n.id === noteId ? { ...n, slide: Math.max(0, Math.min(127, slide)) } : n,
            ),
        },
    });
};

export const setNotePitchBend = (clipId: string, noteId: string, pitchBend: number): void => {
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
                n.id === noteId ? { ...n, pitchBend: Math.max(-8192, Math.min(8191, pitchBend)) } : n,
            ),
        },
    });
};

export const movePitchBend = (
    clipId: string,
    pbId: string,
    newBeat: number,
    newValue: number,
): void => {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.pitchBendByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        pitchBendByClipId: {
            ...state.pitchBendByClipId,
            [clipId]: existing.map((pb) =>
                pb.id === pbId
                    ? { ...pb, beat: Math.max(0, newBeat), value: Math.max(0, Math.min(127, newValue)) }
                    : pb,
            ),
        },
    });
};
