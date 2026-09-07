import { type MidiCC, type MidiNote } from '../models/MidiNote';
import { defaultMidiStoreState, midiStore } from '../stores/midiStore';

type MergeImportedMidiClipNotesInput = {
    notesByClipId: Record<string, MidiNote[]>;
    /** Optional so notes-only callers keep their exact current behaviour. */
    ccByClipId?: Record<string, MidiCC[]>;
};

type RowsSnapshot<TRow> = Map<string, { found: true; rows: TRow[] } | { found: false }>;

type MergeImportedMidiClipNotesOutput = {
    undo: () => void;
    redo: () => void;
};

function captureRows<TRow>(rowsByClipId: Record<string, TRow[]>, clipIds: readonly string[]): RowsSnapshot<TRow> {
    const snapshot: RowsSnapshot<TRow> = new Map();
    for (const clipId of clipIds) {
        if (Object.hasOwn(rowsByClipId, clipId)) {
            snapshot.set(clipId, { found: true, rows: rowsByClipId[clipId] ?? [] });
        } else {
            snapshot.set(clipId, { found: false });
        }
    }
    return snapshot;
}

function restoreRows<TRow>(target: Record<string, TRow[]>, snapshot: RowsSnapshot<TRow>): Record<string, TRow[]> {
    const restored = { ...target };
    for (const [clipId, clipSnapshot] of snapshot) {
        if (clipSnapshot.found) {
            restored[clipId] = clipSnapshot.rows;
        } else {
            delete restored[clipId];
        }
    }
    return restored;
}

export function mergeImportedMidiClipNotes({
    notesByClipId,
    ccByClipId,
}: MergeImportedMidiClipNotesInput): MergeImportedMidiClipNotesOutput {
    const clipIds = Object.keys(notesByClipId);
    const ccClipIds = ccByClipId === undefined ? [] : Object.keys(ccByClipId);
    let previousNotes: RowsSnapshot<MidiNote> = new Map();
    let previousCCs: RowsSnapshot<MidiCC> = new Map();

    function apply(): void {
        const currentState = midiStore.value ?? defaultMidiStoreState;
        previousNotes = captureRows(currentState.notesByClipId, clipIds);
        previousCCs = captureRows(currentState.ccByClipId, ccClipIds);

        midiStore.set({
            ...currentState,
            notesByClipId: {
                ...currentState.notesByClipId,
                ...notesByClipId,
            },
            ...(ccByClipId === undefined ? {} : { ccByClipId: { ...currentState.ccByClipId, ...ccByClipId } }),
        });
    }

    function undo(): void {
        const currentState = midiStore.value ?? defaultMidiStoreState;
        const restoredNotes = restoreRows(currentState.notesByClipId, previousNotes);
        const restoredCCs =
            ccByClipId === undefined ? currentState.ccByClipId : restoreRows(currentState.ccByClipId, previousCCs);

        midiStore.set({ ...currentState, notesByClipId: restoredNotes, ccByClipId: restoredCCs });
    }

    apply();
    return { undo, redo: apply };
}
