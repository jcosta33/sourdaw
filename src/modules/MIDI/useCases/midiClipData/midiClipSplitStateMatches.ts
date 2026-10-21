import { type AppAction } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { midiStore, type MidiStoreState } from '../../stores/midiStore';

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
    let snapshot: {
        notes: { present: boolean; value: readonly unknown[] };
        controlChanges: { present: boolean; value: readonly unknown[] };
        pitchBends: { present: boolean; value: readonly unknown[] };
    } = snapshotMidiClipData(state, clipId);
    for (const action of priorActions) {
        if (action.type === 'removeClip' && action.payload.clipId === clipId) {
            snapshot = {
                notes: { present: false, value: [] },
                controlChanges: { present: false, value: [] },
                pitchBends: { present: false, value: [] },
            };
        }
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
        if (action.type === 'restoreClip') {
            ownerIds.add(action.payload.clipId);
        } else if (action.type === 'restoreClipSplitState') {
            ownerIds.add(action.payload.clipId);
            ownerIds.add(action.payload.rightClipId);
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
    if (!state) {
        return [expectedSource, expectedRight, replacementSource, replacementRight].every(snapshotIsAbsent);
    }
    return (
        snapshotsEqual(projectSnapshot(state, sourceClipId, priorActions), expectedSource) &&
        snapshotsEqual(projectSnapshot(state, rightClipId, priorActions), expectedRight) &&
        replacementIdentitiesAreAvailable(input, state, priorActions)
    );
}
