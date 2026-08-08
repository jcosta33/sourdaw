import { createMidiNote, type MidiCC, type MidiNote, type MidiPitchBend } from '../../models/MidiNote';
import { transformMidiGlobalTimeState } from '../../services/transformMidiGlobalTimeState';
import { midiStore } from '../../stores/midiStore';

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

function snapshotClipData(clipId: string): MidiClipDataActionSnapshot {
    const state = midiStore.value;
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
    const previousSource = snapshotClipData(sourceClipId);
    const previousRight = snapshotClipData(rightClipId);
    const state = midiStore.value;
    if (!state || !splitNotes) {
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
        nextSource: {
            notes: {
                present: Object.hasOwn(nextState.notesByClipId, sourceClipId),
                value: structuredClone(nextState.notesByClipId[sourceClipId] ?? []),
            },
            controlChanges: previousSource.controlChanges,
            pitchBends: previousSource.pitchBends,
        },
        nextRight: {
            notes: {
                present: Object.hasOwn(nextState.notesByClipId, rightClipId),
                value: structuredClone(nextState.notesByClipId[rightClipId] ?? []),
            },
            controlChanges: previousRight.controlChanges,
            pitchBends: previousRight.pitchBends,
        },
    };
}
