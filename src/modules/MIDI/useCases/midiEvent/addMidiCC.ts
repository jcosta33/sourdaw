import { createMidiError } from '../../errors/MidiError';
import { createMidiCC, type MidiCC } from '../../models/MidiNote';
import {
    editSetsBendRangeWhereItLands,
    isCarriedBendReturnOnEditedHead,
} from '../../services/registeredParameterState';
import { midiStore } from '../../stores/midiStore';

export function addMidiCC(
    clipId: string,
    controller: number,
    value: number,
    beat: number,
    channel = 0,
    id?: string
): MidiCC {
    const state = midiStore.value;
    if (!state) {
        throw createMidiError('MIDI store not initialized');
    }

    const created = createMidiCC(controller, value, beat, channel);
    // Undo/redo re-creates a removed point under the id the history entries
    // captured; a freshly minted id would orphan the opposite callback.
    const cc: MidiCC = id === undefined ? created : { ...created, id };
    const existing = state.ccByClipId[clipId] ?? [];

    // A CC point is keyed by (beat, channel, controller). Replace any existing
    // point at the same key rather than appending a duplicate, so repeated
    // calls update the value in place instead of stacking overlapping events.
    // A point that changes RPN 0's bend range where it lands also replaces the
    // returns a split or glue wrote just after the same head, which would re-send
    // the state at the cut over it for every later bend.
    const replacesReturns = editSetsBendRangeWhereItLands(existing, cc);
    const deduped = existing.filter(
        (event) =>
            !(event.beat === beat && event.channel === channel && event.controller === controller) &&
            !(replacesReturns && isCarriedBendReturnOnEditedHead(event, cc))
    );

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: [...deduped, cc],
        },
    });

    return cc;
}
