import { createScratchPadSection } from '../../../models/ScratchPadSection';
import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';

export function captureArrangementToScratchPad(): void {
    const markerState = markerStore.value;
    if (!markerState || markerState.sections.length === 0) {
        return;
    }
    const sorted = [...markerState.sections].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat);
    const scratchSections = sorted.map((state, index) => createScratchPadSection(state.startBeat, state.endBeat, state.name, state.color, index));
    scratchPadStore.set({ sections: scratchSections });
}
