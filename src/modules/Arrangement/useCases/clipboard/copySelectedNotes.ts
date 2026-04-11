import { inject } from '#/infra/di/inject';
import { midiStore } from '#/modules/MIDI/stores';
import { setNoteClipboard } from '#/modules/Arrangement/stores/clipboardStore';

export const copySelectedNotesDependencies = {
    midiStore,
    setNoteClipboard,
};

export const copySelectedNotes = inject(copySelectedNotesDependencies)(
    ({ midiStore: midi, setNoteClipboard: setNotes }) =>
        function copySelectedNotes(clipId: string, noteIds: string[]): void {
            const midiState = midi.value;
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

            setNotes({
                notes: selected.map((n) => ({ ...n })),
            });
        }
);
