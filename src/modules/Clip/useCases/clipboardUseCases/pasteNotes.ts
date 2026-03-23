import { midiStore } from '#/modules/Midi/stores/midiStore';
import { type MidiNote, createMidiNote } from '#/modules/Midi/models/MidiNote';
import { noteClipboard } from '#/modules/Clip/stores/clipboardStore';

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
