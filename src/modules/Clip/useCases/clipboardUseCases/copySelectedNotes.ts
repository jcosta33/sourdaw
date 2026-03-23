import { midiStore } from '#/modules/Midi/stores/midiStore';
import { setNoteClipboard } from '#/modules/Clip/stores/clipboardStore';

export function copySelectedNotes(clipId: string, noteIds: string[]): void {
    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const notes = midiState.notesByClipId[clipId];
    if (!notes) {
        return;
    }

    const selected = notes.filter((n) => noteIds.includes(n.id));
    if (selected.length === 0) {
        return;
    }

    setNoteClipboard({
        notes: selected.map((n) => ({ ...n })),
    });
}
