import { markerStore } from '#/modules/Arrangement/stores';

/** The live markers and sections as grounding reads them, so every grounding of one run reads the same set. */
export function readPlanningMarkerSignatures() {
    return {
        markerSignatures: (markerStore.value?.markers ?? []).map((marker) => ({
            beat: marker.beat,
            color: marker.color,
            markerId: marker.id,
            name: marker.name,
        })),
        sectionSignatures: (markerStore.value?.sections ?? []).map((section) => ({
            endBeat: section.endBeat,
            name: section.name,
            sectionId: section.id,
            startBeat: section.startBeat,
        })),
    };
}
