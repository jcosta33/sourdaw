import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { type MidiNote } from '#/modules/Arrangement/models/MidiNoteViewTypes';
import { createMidiNote } from '#/modules/MIDI/useCases/createMidiNote';
import { noteClipboard } from '#/modules/Arrangement/stores/clipboardStore';

export function pasteNotes(clipId: string, beatOffset: number): void {
    if (!noteClipboard || noteClipboard.notes.length === 0) {
        return;
    }

    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const existing = midiState.notesByClipId[clipId] ?? [];

    const minStart = Math.min(...noteClipboard.notes.map((n) => n.startBeat));

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
