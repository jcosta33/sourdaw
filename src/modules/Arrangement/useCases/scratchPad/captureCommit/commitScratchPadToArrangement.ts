import { scratchPadStore } from '../../../stores/scratchPadStore';
import { markerStore } from '../../../stores/markerStore';

export function commitScratchPadToArrangement(): void {
    const padState = scratchPadStore.value;
    const markerState = markerStore.value;
    if (!padState || !markerState || padState.sections.length === 0) {
        return;
    }

    const newSections = [...padState.sections]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
            id: `section-committed-${crypto.randomUUID().slice(0, 8)}`,
            startBeat: s.startBeat,
            endBeat: s.endBeat,
            name: s.name,
            color: s.color,
        }));

    markerStore.set({ ...markerState, sections: newSections });
}