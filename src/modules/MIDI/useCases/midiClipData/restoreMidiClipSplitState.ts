import { midiStore } from '../../stores/midiStore';

import { midiClipSplitStateMatches, type MidiClipSplitStateMatchInput } from './midiClipSplitStateMatches';

type MidiClipDataSlotSnapshot<Row> = {
    present: boolean;
    value: readonly Row[];
};

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

export function restoreMidiClipSplitState(input: MidiClipSplitStateMatchInput): boolean {
    const { sourceClipId, rightClipId, replacementSource, replacementRight } = input;
    const state = midiStore.value;
    if (!midiClipSplitStateMatches(input, state)) {
        return false;
    }
    if (!state) {
        return true;
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
