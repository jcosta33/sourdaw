import { type AppAction } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { isExactMidiClipDataActionSnapshot } from '../../services/isExactMidiClipDataActionSnapshot';
import { midiStore, type MidiStoreState } from '../../stores/midiStore';

import { projectMidiSnapshotThroughAction, type ProjectedMidiSnapshot } from './projectMidiSnapshotThroughAction';
import { readRestoredMidiOwnerIds } from './readRestoredMidiOwnerIds';
import { snapshotMidiClipData } from './snapshotMidiClipData';

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

function projectSnapshot(state: MidiStoreState, clipId: string, priorActions: readonly AppAction[]) {
    let snapshot: ProjectedMidiSnapshot = snapshotMidiClipData(state, clipId);
    for (const action of priorActions) {
        snapshot = projectMidiSnapshotThroughAction(action, clipId, snapshot);
    }
    return snapshot;
}

function snapshotIds(snapshot: ReturnType<typeof projectSnapshot>): string[] {
    return [snapshot.notes, snapshot.controlChanges, snapshot.pitchBends].flatMap((slot) =>
        slot.present ? slot.value.flatMap((row) => (isRecord(row) && typeof row.id === 'string' ? [row.id] : [])) : []
    );
}

/** Reserve identities in the MIDI owner's actual replay prefix. Both affected
 * buckets are replaced together, so their own rows may move between the legs;
 * retained peer rows and preceding members' restored rows keep their IDs. */
function replacementIdentitiesAreAvailable(
    input: MidiClipSplitStateMatchInput,
    state: MidiStoreState,
    priorActions: readonly AppAction[]
): boolean {
    const ownerIds = new Set([
        ...Object.keys(state.notesByClipId),
        ...Object.keys(state.ccByClipId),
        ...Object.keys(state.pitchBendByClipId),
    ]);
    for (const action of priorActions) {
        for (const clipId of readRestoredMidiOwnerIds(action)) {
            ownerIds.add(clipId);
        }
    }
    const occupied = new Set<string>();
    for (const clipId of ownerIds) {
        if (clipId !== input.sourceClipId && clipId !== input.rightClipId) {
            for (const id of snapshotIds(projectSnapshot(state, clipId, priorActions))) {
                occupied.add(id);
            }
        }
    }
    for (const id of [...snapshotIds(input.replacementSource), ...snapshotIds(input.replacementRight)]) {
        if (occupied.has(id)) {
            return false;
        }
        occupied.add(id);
    }
    return true;
}

/** Same precondition `restoreMidiClipSplitState` writes against, kept as the sole export of its
 *  own file (rather than a second export alongside the write) so a handler's `validate` can
 *  preflight a batch without triggering the write that `restoreMidiClipSplitState` performs once
 *  the precondition holds.
 *
 *  `state` is a parameter so the write path can check and write against one store read. A caller
 *  that only preflights omits it. */
export function midiClipSplitStateMatches(
    input: MidiClipSplitStateMatchInput,
    state: MidiStoreState | null = midiStore.value,
    priorActions: readonly AppAction[] = []
): boolean {
    const { sourceClipId, rightClipId, expectedSource, expectedRight, replacementSource, replacementRight } = input;
    if (
        ![expectedSource, expectedRight, replacementSource, replacementRight].every(isExactMidiClipDataActionSnapshot)
    ) {
        return false;
    }
    if (!state) {
        return [expectedSource, expectedRight, replacementSource, replacementRight].every(snapshotIsAbsent);
    }
    return (
        snapshotsEqual(projectSnapshot(state, sourceClipId, priorActions), expectedSource) &&
        snapshotsEqual(projectSnapshot(state, rightClipId, priorActions), expectedRight) &&
        replacementIdentitiesAreAvailable(input, state, priorActions)
    );
}
