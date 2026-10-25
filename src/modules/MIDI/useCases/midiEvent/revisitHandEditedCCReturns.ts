import { CC_DATA_ENTRY_LSB } from '../../models/MidiControllerState';
import { reconcileHandEditedReturns } from '../../services/registeredParameterState';
import { midiStore } from '../../stores/midiStore';

/**
 * Rewrites the returns a split or glue wrote just after a clip's head so they keep restoring the state at the
 * cut under what the clip's visible rows now set there. Every hand edit of the point at the head — adding or
 * replacing it through `addMidiCC`, moving it, deleting it — must end in one call, because the returns are the
 * last word the stored reader replays there: left stale, they govern later bends with a range neither a visible
 * point nor the cut state sets. `editedController` names the controller the gesture edited: a Data Entry LSB
 * sets no coarse range alone, so an edit of one refines the returns only beside a coarse Data Entry.
 */
export function revisitHandEditedCCReturns(
    clipId: string,
    head: { channel: number; beat: number },
    options: { editedController?: number } = {}
): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }
    const rows = state.ccByClipId[clipId];
    if (!rows) {
        return;
    }
    const revisited = reconcileHandEditedReturns(rows, head, {
        fineOnlyEdit: options.editedController === CC_DATA_ENTRY_LSB,
    });
    if (revisited === null) {
        return;
    }
    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: [...revisited],
        },
    });
}
