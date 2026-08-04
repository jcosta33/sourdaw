import { createSection } from '../../../models/Marker';
import { markerStore } from '../../../stores/markerStore';

export function addSection(
    startBeat: number,
    endBeat: number,
    name: string,
    sectionId?: string,
    color?: string
): boolean {
    const state = markerStore.value;
    if (!state) {
        return false;
    }
    const base = createSection(startBeat, endBeat, name);
    // Optional caller-supplied identity/color let undo restore the exact
    // section (removeSection's inverse) instead of a lookalike with a fresh id.
    const section = { ...base, id: sectionId ?? base.id, color: color ?? base.color };
    markerStore.set({ ...state, sections: [...state.sections, section] });
    return true;
}
