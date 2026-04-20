import { createScratchPadSection } from '../../../models/ScratchPadSection';
import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';

export function captureArrangementToScratchPad(): void {
    const markerState = markerStore.value;
    if (!markerState || markerState.sections.length === 0) {
        return;
    }
    const sorted = [...markerState.sections].sort((a, b) => a.startBeat - b.startBeat);
    const scratchSections = sorted.map((s, i) => createScratchPadSection(s.startBeat, s.endBeat, s.name, s.color, i));
    scratchPadStore.set({ sections: scratchSections });
}
