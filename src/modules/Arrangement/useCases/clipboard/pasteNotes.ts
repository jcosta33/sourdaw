import { appendMidiNotes } from '#/modules/MIDI/useCases';

import { clipboardStore } from '../../stores/clipboardStore';

export function pasteNotes(clipId: string, beatOffset: number): void {
    const noteClipboard = clipboardStore.value?.noteClipboard ?? null;
    if (!noteClipboard || noteClipboard.notes.length === 0) {
        return;
    }

    let minStart = Infinity;
    for (const node of noteClipboard.notes) {
        if (node.startBeat < minStart) {
            minStart = node.startBeat;
        }
    }

    const pastedNotes = noteClipboard.notes.map((node) => ({
        ...node,
        startBeat: node.startBeat - minStart + beatOffset,
    }));

    appendMidiNotes({
        clipId,
        notes: pastedNotes,
    });
}
