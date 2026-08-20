import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { midiStore, type MidiStoreState } from '../../stores/midiStore';

type MidiClipDataSlotSnapshot<Row> = {
    present: boolean;
    value: readonly Row[];
};

type MidiClipDataActionSnapshot = {
    notes: MidiClipDataSlotSnapshot<MidiNote>;
    controlChanges: MidiClipDataSlotSnapshot<MidiCC>;
    pitchBends: MidiClipDataSlotSnapshot<MidiPitchBend>;
};

export type MidiClipSplitStateMatchInput = {
    sourceClipId: string;
    rightClipId: string;
    expectedSource: MidiClipDataActionSnapshot;
    expectedRight: MidiClipDataActionSnapshot;
    replacementSource: MidiClipDataActionSnapshot;
    replacementRight: MidiClipDataActionSnapshot;
};

function snapshotsEqual(left: MidiClipDataActionSnapshot, right: MidiClipDataActionSnapshot): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function snapshotIsAbsent(snapshot: MidiClipDataActionSnapshot): boolean {
    return !snapshot.notes.present && !snapshot.controlChanges.present && !snapshot.pitchBends.present;
}

function snapshotClipData(state: MidiStoreState, clipId: string): MidiClipDataActionSnapshot {
    return {
        notes: {
            present: Object.hasOwn(state.notesByClipId, clipId),
            value: structuredClone(state.notesByClipId[clipId] ?? []),
        },
        controlChanges: {
            present: Object.hasOwn(state.ccByClipId, clipId),
            value: structuredClone(state.ccByClipId[clipId] ?? []),
        },
        pitchBends: {
            present: Object.hasOwn(state.pitchBendByClipId, clipId),
            value: structuredClone(state.pitchBendByClipId[clipId] ?? []),
        },
    };
}

/** Same precondition `restoreMidiClipSplitState` writes against, kept as the sole export of its
 *  own file (rather than a second export alongside the write) so a handler's `validate` can
 *  preflight a batch without triggering the write that `restoreMidiClipSplitState` performs once
 *  the precondition holds. */
export function midiClipSplitStateMatches({
    sourceClipId,
    rightClipId,
    expectedSource,
    expectedRight,
    replacementSource,
    replacementRight,
}: MidiClipSplitStateMatchInput): boolean {
    const state = midiStore.value;
    if (!state) {
        return [expectedSource, expectedRight, replacementSource, replacementRight].every(snapshotIsAbsent);
    }
    return (
        snapshotsEqual(snapshotClipData(state, sourceClipId), expectedSource) &&
        snapshotsEqual(snapshotClipData(state, rightClipId), expectedRight)
    );
}
