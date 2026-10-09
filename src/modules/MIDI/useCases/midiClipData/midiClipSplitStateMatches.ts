import { type AppAction } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

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

function snapshotsEqual(left: unknown, right: unknown): boolean {
    return valuesEqual(left, right);
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

function projectSnapshot(state: MidiStoreState, clipId: string, priorActions: readonly AppAction[]) {
    let snapshot: {
        notes: { present: boolean; value: readonly unknown[] };
        controlChanges: { present: boolean; value: readonly unknown[] };
        pitchBends: { present: boolean; value: readonly unknown[] };
    } = snapshotClipData(state, clipId);
    for (const action of priorActions) {
        if (action.type === 'restoreClip' && action.payload.clipId === clipId) {
            const payload = action.payload;
            let notes = snapshot.notes;
            let controlChanges = snapshot.controlChanges;
            let pitchBends = snapshot.pitchBends;
            if (payload.midiNotesSnapshot !== null) {
                notes = { present: true, value: payload.midiNotesSnapshot };
            }
            if (payload.midiCcSnapshot !== null) {
                controlChanges = { present: true, value: payload.midiCcSnapshot };
            }
            if (payload.midiPitchBendSnapshot !== null) {
                pitchBends = { present: true, value: payload.midiPitchBendSnapshot };
            }
            snapshot = { notes, controlChanges, pitchBends };
        }
        if (action.type === 'restoreClipSplitState') {
            if (action.payload.clipId === clipId) {
                snapshot = action.payload.replacement.sourceMidi;
            }
            if (action.payload.rightClipId === clipId) {
                snapshot = action.payload.replacement.rightMidi;
            }
        }
    }
    return snapshot;
}

/** Same precondition `restoreMidiClipSplitState` writes against, kept as the sole export of its
 *  own file (rather than a second export alongside the write) so a handler's `validate` can
 *  preflight a batch without triggering the write that `restoreMidiClipSplitState` performs once
 *  the precondition holds.
 *
 *  `state` is a parameter so the write path can check and write against one store read. A caller
 *  that only preflights omits it. */
export function midiClipSplitStateMatches(
    {
        sourceClipId,
        rightClipId,
        expectedSource,
        expectedRight,
        replacementSource,
        replacementRight,
    }: MidiClipSplitStateMatchInput,
    state: MidiStoreState | null = midiStore.value,
    priorActions: readonly AppAction[] = []
): boolean {
    if (!state) {
        return [expectedSource, expectedRight, replacementSource, replacementRight].every(snapshotIsAbsent);
    }
    return (
        snapshotsEqual(projectSnapshot(state, sourceClipId, priorActions), expectedSource) &&
        snapshotsEqual(projectSnapshot(state, rightClipId, priorActions), expectedRight)
    );
}
