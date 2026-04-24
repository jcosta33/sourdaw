import { midiStore } from '#/modules/MIDI/stores';

import { setNoteClipboard } from '../../stores/clipboardStore';

export function copySelectedNotes(clipId: string, noteIds: string[]): void {
    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const notes = midiState.notesByClipId[clipId];
    if (!notes) {
        return;
    }

    const selected = notes.filter((node) => noteIds.includes(node.id));
    if (selected.length === 0) {
        return;
    }

    setNoteClipboard({
        notes: selected.map((node) => ({ ...node })),
    });
}
