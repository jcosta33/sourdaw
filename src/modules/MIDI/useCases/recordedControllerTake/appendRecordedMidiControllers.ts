import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

type AppendRecordedMidiControllersInput = {
    clipId: string;
    cc: readonly MidiCC[];
    pitchBend: readonly MidiPitchBend[];
    /** Give the clip an empty note list when it has none: playback admits a MIDI clip only by its note list. */
    ensureNoteList?: boolean;
};

/** The note lists with an empty one for `clipId` when it has none. */
function withNoteList(notesByClipId: Record<string, MidiNote[]>, clipId: string): Record<string, MidiNote[]> {
    if (notesByClipId[clipId] !== undefined) {
        return notesByClipId;
    }
    return { ...notesByClipId, [clipId]: [] };
}

/** The per-clip lists with `appended` after the clip's existing rows; the lists themselves when there is nothing to add. */
function withAppendedRows<TRow>(
    rowsByClipId: Record<string, TRow[]>,
    clipId: string,
    appended: readonly TRow[]
): Record<string, TRow[]> {
    if (appended.length === 0) {
        return rowsByClipId;
    }
    const existing = rowsByClipId[clipId] ?? [];
    return { ...rowsByClipId, [clipId]: [...existing, ...appended] };
}

/**
 * Append a take's controller and pitch-bend rows to its clip in ONE store
 * write, in the order given. Unlike `addMidiCC`, which keeps a lane's
 * (beat, channel, controller) point unique for editing, a take keeps every
 * message: a burst sharing one beat, such as an RPN select, data entry and
 * null-RPN sequence, must survive whole.
 *
 * A take's commit also asks for the clip's note list (`ensureNoteList`) in the
 * same write: a take of controllers alone has no note recorded into the store,
 * and stored playback and export skip a MIDI clip that has no note list, so the
 * take would be stored and silent.
 *
 * Carries no undo entry; the recording commit snapshots the rows. Rows come
 * with the ids they keep and were validated when they were buffered, so this
 * trusts them.
 */
export function appendRecordedMidiControllers({
    clipId,
    cc,
    pitchBend,
    ensureNoteList = false,
}: AppendRecordedMidiControllersInput): void {
    if (cc.length === 0 && pitchBend.length === 0 && !ensureNoteList) {
        return;
    }
    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    midiStore.set({
        ...midiState,
        notesByClipId: ensureNoteList ? withNoteList(midiState.notesByClipId, clipId) : midiState.notesByClipId,
        ccByClipId: withAppendedRows(midiState.ccByClipId, clipId, cc),
        pitchBendByClipId: withAppendedRows(midiState.pitchBendByClipId, clipId, pitchBend),
    });
}
