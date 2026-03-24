import { midiStore } from '#/modules/MIDI/stores/midiStore';

export function retrogradeNotes(clipId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length < 2) {
        return;
    }

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
}
