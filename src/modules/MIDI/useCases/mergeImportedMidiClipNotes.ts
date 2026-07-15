import { type MidiNote } from '../models/MidiNote';
import { defaultMidiStoreState, midiStore, type MidiStoreState } from '../stores/midiStore';

type MergeImportedMidiClipNotesInput = {
    notesByClipId: Record<string, MidiNote[]>;
};

type NotesSnapshot = Map<string, { found: true; notes: MidiNote[] } | { found: false }>;

type MergeImportedMidiClipNotesOutput = {
    undo: () => void;
    redo: () => void;
};

function captureNotes(notesByClipId: MidiStoreState['notesByClipId'], clipIds: readonly string[]): NotesSnapshot {
    const snapshot: NotesSnapshot = new Map();
    for (const clipId of clipIds) {
        if (Object.hasOwn(notesByClipId, clipId)) {
            snapshot.set(clipId, { found: true, notes: notesByClipId[clipId] ?? [] });
        } else {
            snapshot.set(clipId, { found: false });
        }
    }
    return snapshot;
}

export function mergeImportedMidiClipNotes({
    notesByClipId,
}: MergeImportedMidiClipNotesInput): MergeImportedMidiClipNotesOutput {
    const clipIds = Object.keys(notesByClipId);
    let previousNotes: NotesSnapshot = new Map();

    function apply(): void {
        const currentState = midiStore.value ?? defaultMidiStoreState;
        previousNotes = captureNotes(currentState.notesByClipId, clipIds);

        midiStore.set({
            ...currentState,
            notesByClipId: {
                ...currentState.notesByClipId,
                ...notesByClipId,
            },
        });
    }

    function undo(): void {
        const currentState = midiStore.value ?? defaultMidiStoreState;
        const restoredNotes = { ...currentState.notesByClipId };

        for (const [clipId, snapshot] of previousNotes) {
            if (snapshot.found) {
                restoredNotes[clipId] = snapshot.notes;
            } else {
                delete restoredNotes[clipId];
            }
        }

        midiStore.set({ ...currentState, notesByClipId: restoredNotes });
    }

    apply();
    return { undo, redo: apply };
}
