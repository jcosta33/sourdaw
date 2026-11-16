import { type ListRestoreSlot, insertAtListRestoreSlot } from '../../../models/ListRestoreSlot';
import { createSection } from '../../../models/Marker';
import { markerStore } from '../../../stores/markerStore';

export function addSection(
    startBeat: number,
    endBeat: number,
    name: string,
    sectionId?: string,
    color?: string,
    slot: ListRestoreSlot = {}
): boolean {
    const state = markerStore.value;
    if (!state) {
        return false;
    }
    const base = createSection(startBeat, endBeat, name);
    // Optional caller-supplied identity/color let undo restore the exact
    // section (removeSection's inverse) instead of a lookalike with a fresh id.
    const section = { ...base, id: sectionId ?? base.id, color: color ?? base.color };
    // Section array order is project truth, so removeSection's inverse restores
    // the original neighbours (see ListRestoreSlot).
    markerStore.set({ ...state, sections: insertAtListRestoreSlot(state.sections, section, slot) });
    return true;
}
