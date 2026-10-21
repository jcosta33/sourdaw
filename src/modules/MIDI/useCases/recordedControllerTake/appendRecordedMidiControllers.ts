import { createMidiCC, createMidiPitchBend } from '../../models/MidiNote';
import { type RecordedCcRow, type RecordedPitchBendRow } from '../../repositories/webMidi/recordedControllerTakeState';
import { midiStore } from '../../stores/midiStore';

type AppendRecordedMidiControllersInput = {
    clipId: string;
    cc: readonly RecordedCcRow[];
    pitchBend: readonly RecordedPitchBendRow[];
};

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
 * Carries no undo entry; the recording commit snapshots the rows. Rows are
 * validated when they are buffered, so this trusts them.
 */
export function appendRecordedMidiControllers({ clipId, cc, pitchBend }: AppendRecordedMidiControllersInput): void {
    if (cc.length === 0 && pitchBend.length === 0) {
        return;
    }
    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    midiStore.set({
        ...midiState,
        ccByClipId: withAppendedRows(
            midiState.ccByClipId,
            clipId,
            cc.map((row) => createMidiCC(row.controller, row.value, row.beat, row.channel))
        ),
        pitchBendByClipId: withAppendedRows(
            midiState.pitchBendByClipId,
            clipId,
            pitchBend.map((row) => createMidiPitchBend(row.value, row.beat, row.channel))
        ),
    });
}
