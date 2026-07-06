import { createSection, type ArrangementSection } from '../models/Marker';
import { markerStore } from '../stores/markerStore';

import { detectSongStructure } from './detectSongStructure';
import { type DetectedSection } from './songStructureDetection';

/**
 * Detect song structure and apply results as arrangement sections.
 */
export function detectAndApplySongStructure(trackId?: string): DetectedSection[] {
    const sections = detectSongStructure(trackId);
    if (sections.length === 0) {
        return [];
    }

    const markerState = markerStore.value;
    if (!markerState) {
        return sections;
    }

    // Add detected sections to the marker store
    const newSections: ArrangementSection[] = sections.map((state) => {
        const section = createSection(state.startBeat, state.endBeat, state.name);
        return { ...section, color: state.color };
    });

    markerStore.set({
        ...markerState,
        sections: [...markerState.sections, ...newSections],
    });

    return sections;
}
