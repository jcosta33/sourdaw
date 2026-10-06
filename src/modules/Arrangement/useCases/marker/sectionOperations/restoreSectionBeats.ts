import { type ArrangementSection, markerStore } from '../../../stores/markerStore';

type SectionBeats = { sectionId: string; startBeat: number; endBeat: number; index: number };

/**
 * Restores each named section to its exact recorded beat span and, when the
 * document still allows it, its recorded list position. Unlike
 * `moveSection`/`resizeSection` this rounds nothing — the reorder inverse must
 * put back fractional beats and gaps exactly as `describe` captured them.
 *
 * The beats are the inverse's substance and always restore; the slot is
 * best-effort. A section moves to its recorded slot only when that slot's live
 * occupant is itself a named restoration vacating it — the closed swap the
 * reorder recorded. Anything else (a slot the document no longer offers, an
 * occupant that cannot vacate, replay after intervening structural edits)
 * leaves the section at its live position with its beats restored in place, so
 * a refused slot never evicts a section that stays and one slot never carries
 * two restorations.
 */
export function restoreSectionBeats(restorations: ReadonlyArray<SectionBeats>): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    const namedSectionIds = new Set(restorations.map((restoration) => restoration.sectionId));
    const restorationBySectionId = new Map(
        restorations.map((restoration) => [restoration.sectionId, restoration] as const)
    );
    const liveIndexBySectionId = new Map(state.sections.map((section, index) => [section.id, index] as const));

    // One inverse records distinct slots; a duplicate (never produced today)
    // pins the later claimant to its live slot so the slot stays single-claimed.
    const pinnedToLiveSlot = new Set<string>();
    const seenRecordedSlots = new Set<number>();
    for (const restoration of restorations) {
        if (seenRecordedSlots.has(restoration.index)) {
            pinnedToLiveSlot.add(restoration.sectionId);
        }
        seenRecordedSlots.add(restoration.index);
    }

    // Whether a section leaves its live position for its recorded one: the
    // recorded slot must be held by a named restoration that vacates it in
    // turn, so admission follows the occupants until the swap closes. An
    // unnamed occupant, a missing or out-of-range slot, or an occupant that
    // stays refuses the whole chain back to the section that started it.
    const vacatesLiveSlot = (sectionId: string, chain: ReadonlySet<string>): boolean => {
        if (chain.has(sectionId)) {
            return true;
        }
        const restoration = restorationBySectionId.get(sectionId);
        if (restoration === undefined || pinnedToLiveSlot.has(sectionId)) {
            return false;
        }
        const occupant = state.sections[restoration.index];
        if (occupant === undefined || occupant.id === sectionId || !namedSectionIds.has(occupant.id)) {
            return false;
        }
        return vacatesLiveSlot(occupant.id, new Set(chain).add(sectionId));
    };

    const restoredBySlot = new Map<number, ArrangementSection>();
    for (const restoration of restorations) {
        const liveIndex = liveIndexBySectionId.get(restoration.sectionId);
        if (liveIndex === undefined) {
            continue;
        }
        const slot = vacatesLiveSlot(restoration.sectionId, new Set()) ? restoration.index : liveIndex;
        const live = state.sections[liveIndex]!;
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
