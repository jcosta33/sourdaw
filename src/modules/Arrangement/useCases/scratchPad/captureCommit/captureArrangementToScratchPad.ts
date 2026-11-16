import { createScratchPadSection, createScratchPadSectionId } from '../../../models/ScratchPadSection';
import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';

/**
 * Copy the arrangement's sections into the scratch pad, in timeline order. The pad section at
 * each position takes the seeded id at that position. The markers a replayed capture reads may
 * hold more or fewer sections than the ones the ids were drawn for, so a position past the seeded
 * ids gets a fresh id and a seeded id past the last section is ignored.
 */
export function captureArrangementToScratchPad(sectionIds: readonly string[] = []): void {
    const markerState = markerStore.value;
    if (!markerState || markerState.sections.length === 0) {
        return;
    }
    const sorted = [...markerState.sections].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat);
    const scratchSections = sorted.map((state, index) =>
        createScratchPadSection(
            state.startBeat,
            state.endBeat,
            state.name,
            state.color,
            index,
            sectionIds[index] ?? createScratchPadSectionId()
        )
    );
    scratchPadStore.set({ sections: scratchSections });
}
