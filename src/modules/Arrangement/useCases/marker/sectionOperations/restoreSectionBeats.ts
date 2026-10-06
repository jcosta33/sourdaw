import { type ArrangementSection, markerStore } from '../../../stores/markerStore';

type SectionBeats = { sectionId: string; startBeat: number; endBeat: number; index: number };

/**
 * Restores each named section to its exact recorded beat span and list
 * position. Unlike `moveSection`/`resizeSection` this rounds nothing — the
 * reorder inverse must put back fractional beats and gaps exactly as `describe`
 * captured them, and the reorder itself swaps the pair's array slots, so their
 * recorded slots come back too. A section no longer present is skipped; a
 * recorded slot the document no longer offers (replay after intervening
 * structural edits) falls back to the section's live slot so membership never
 * changes.
 */
export function restoreSectionBeats(restorations: ReadonlyArray<SectionBeats>): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    const namedSectionIds = new Set(restorations.map((restoration) => restoration.sectionId));
    const liveIndexBySectionId = new Map(state.sections.map((section, index) => [section.id, index] as const));
    const restoredBySlot = new Map<number, ArrangementSection>();
    const claimedSlots = new Set<number>();
    for (const restoration of restorations) {
        const liveIndex = liveIndexBySectionId.get(restoration.sectionId);
        if (liveIndex === undefined) {
            continue;
        }
        const live = state.sections[liveIndex]!;
        const occupant = state.sections[restoration.index];
        const slotOffersRestore =
            restoration.index >= 0 &&
            restoration.index < state.sections.length &&
            (occupant === undefined || namedSectionIds.has(occupant.id)) &&
            !claimedSlots.has(restoration.index);
        const slot = slotOffersRestore ? restoration.index : liveIndex;
        claimedSlots.add(slot);
        restoredBySlot.set(slot, { ...live, startBeat: restoration.startBeat, endBeat: restoration.endBeat });
    }
    if (restoredBySlot.size === 0) {
        return;
    }
    markerStore.set({
        ...state,
        sections: state.sections.map((section, index) => restoredBySlot.get(index) ?? section),
    });
}
