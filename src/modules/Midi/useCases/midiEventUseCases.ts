import { midiStore } from '../stores/midiStore';
import { createMidiCC, createMidiPitchBend, type MidiCC, type MidiPitchBend } from '../models/MidiNote';

export function addMidiCC(clipId: string, controller: number, value: number, beat: number, channel = 0): MidiCC {
    const state = midiStore.value;
    if (!state) {
        throw new Error('MIDI store not initialized');
    }

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
}

export function removeMidiCC(clipId: string, ccId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.ccByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: existing.filter((c) => c.id !== ccId),
        },
    });
}

export function moveMidiCC(clipId: string, ccId: string, newBeat: number, newValue: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.ccByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: existing.map((c) =>
                c.id === ccId ? { ...c, beat: Math.max(0, newBeat), value: Math.max(0, Math.min(127, newValue)) } : c
            ),
        },
    });
}

export function addPitchBend(clipId: string, value: number, beat: number, channel = 0): MidiPitchBend {
    const state = midiStore.value;
    if (!state) {
        throw new Error('MIDI store not initialized');
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
}

export function removePitchBend(clipId: string, pbId: string): void {
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
}

export function movePitchBend(clipId: string, pbId: string, newBeat: number, newValue: number): void {
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
                pb.id === pbId ? { ...pb, beat: Math.max(0, newBeat), value: Math.max(0, Math.min(127, newValue)) } : pb
            ),
        },
    });
}

export function setNotePressure(clipId: string, noteId: string, pressure: number): void {
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
                n.id === noteId ? { ...n, pressure: Math.max(0, Math.min(127, pressure)) } : n
            ),
        },
    });
}

export function setNoteSlide(clipId: string, noteId: string, slide: number): void {
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
            [clipId]: existing.map((n) => (n.id === noteId ? { ...n, slide: Math.max(0, Math.min(127, slide)) } : n)),
        },
    });
}
