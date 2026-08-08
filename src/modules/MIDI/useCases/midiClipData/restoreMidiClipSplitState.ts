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

type RestoreMidiClipSplitStateInput = {
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

function replaceSlot<Row>(
    current: Record<string, Row[]>,
    clipId: string,
    replacement: MidiClipDataSlotSnapshot<Row>
): Record<string, Row[]> {
    const next = { ...current };
    if (!replacement.present) {
        delete next[clipId];
        return next;
    }
    next[clipId] = [...structuredClone(replacement.value)];
    return next;
}

export function restoreMidiClipSplitState({
    sourceClipId,
    rightClipId,
    expectedSource,
    expectedRight,
    replacementSource,
    replacementRight,
}: RestoreMidiClipSplitStateInput): boolean {
    const state = midiStore.value;
    if (!state) {
        return [expectedSource, expectedRight, replacementSource, replacementRight].every(snapshotIsAbsent);
    }
    if (
        !snapshotsEqual(snapshotClipData(state, sourceClipId), expectedSource) ||
        !snapshotsEqual(snapshotClipData(state, rightClipId), expectedRight)
    ) {
        return false;
    }

    let notesByClipId = replaceSlot(state.notesByClipId, sourceClipId, replacementSource.notes);
    notesByClipId = replaceSlot(notesByClipId, rightClipId, replacementRight.notes);
    let ccByClipId = replaceSlot(state.ccByClipId, sourceClipId, replacementSource.controlChanges);
    ccByClipId = replaceSlot(ccByClipId, rightClipId, replacementRight.controlChanges);
    let pitchBendByClipId = replaceSlot(state.pitchBendByClipId, sourceClipId, replacementSource.pitchBends);
    pitchBendByClipId = replaceSlot(pitchBendByClipId, rightClipId, replacementRight.pitchBends);
    midiStore.set({ ...state, notesByClipId, ccByClipId, pitchBendByClipId });
    return true;
}
