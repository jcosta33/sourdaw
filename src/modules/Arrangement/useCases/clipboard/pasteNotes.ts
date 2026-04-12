import { midiStore } from '#/modules/MIDI/stores';
import { createMidiNote } from '#/modules/MIDI/useCases';
import { type MidiNote } from '../../models/MidiNoteViewTypes';
import { clipboardStore } from '../../stores/clipboardStore';

export function pasteNotes(clipId: string, beatOffset: number): void {
    const noteClipboard = clipboardStore.value?.noteClipboard ?? null;
    if (!noteClipboard || noteClipboard.notes.length === 0) {
        return;
    }

    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const existing = midiState.notesByClipId[clipId] ?? [];

    let minStart = Infinity;
    for (const n of noteClipboard.notes) {
        if (n.startBeat < minStart) { minStart = n.startBeat; }
    }

    const pastedNotes: MidiNote[] = noteClipboard.notes.map((n) =>
        createMidiNote(n.pitch, n.startBeat - minStart + beatOffset, n.duration, n.velocity)
    );

    midiStore.set({
        ...midiState,
        notesByClipId: {
            ...midiState.notesByClipId,
            [clipId]: [...existing, ...pastedNotes],
        },
    });
}
