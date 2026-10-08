import { createMidiNote, type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { transformMidiGlobalTimeState } from '../../services/transformMidiGlobalTimeState';
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

type PrepareMidiClipSplitInput = {
    sourceClipId: string;
    rightClipId: string;
    splitBeat: number;
    splitNotes: boolean;
    targetNoteIds?: readonly string[];
};

function snapshotClipData(clipId: string, state: MidiStoreState | null): MidiClipDataActionSnapshot {
    return {
        notes: {
            present: state ? Object.hasOwn(state.notesByClipId, clipId) : false,
            value: structuredClone(state?.notesByClipId[clipId] ?? []),
        },
        controlChanges: {
            present: state ? Object.hasOwn(state.ccByClipId, clipId) : false,
            value: structuredClone(state?.ccByClipId[clipId] ?? []),
        },
        pitchBends: {
            present: state ? Object.hasOwn(state.pitchBendByClipId, clipId) : false,
            value: structuredClone(state?.pitchBendByClipId[clipId] ?? []),
        },
    };
}

export function prepareMidiClipSplit({
    sourceClipId,
    rightClipId,
    splitBeat,
    splitNotes,
    targetNoteIds,
}: PrepareMidiClipSplitInput) {
    const state = midiStore.value;
    const previousSource = snapshotClipData(sourceClipId, state);
    const previousRight = snapshotClipData(rightClipId, state);
    if (!state || !splitNotes) {
        // Supplied note ids name notes this split would create; with no notes to split there are none,
        // and a plan that carried them would give the receipt notes that do not exist.
        if (targetNoteIds !== undefined && targetNoteIds.length > 0) {
            return null;
        }
        return {
            targetNoteIds: [] as readonly string[],
            previousSource,
            previousRight,
            nextSource: previousSource,
            nextRight: previousRight,
        };
    }

    const commands = [{ type: 'split-notes' as const, sourceClipId, targetClipId: rightClipId, splitBeat }];
    const planned = transformMidiGlobalTimeState({ state, commands });
    if (planned.status === 'rejected') {
        return null;
    }
    const replayIds = targetNoteIds ?? planned.identityRequests.map(() => createMidiNote(0, 0, 0).id);
    const transformed = transformMidiGlobalTimeState({ state, commands, targetNoteIds: replayIds });
    if (transformed.status === 'rejected') {
        return null;
    }

    const nextState = transformed.state;
    return {
        targetNoteIds: [...replayIds],
        previousSource,
        previousRight,
        nextSource: snapshotClipData(sourceClipId, nextState),
        nextRight: snapshotClipData(rightClipId, nextState),
    };
}
