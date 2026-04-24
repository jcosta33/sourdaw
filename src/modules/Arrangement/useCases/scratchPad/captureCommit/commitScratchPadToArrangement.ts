import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';

export function commitScratchPadToArrangement(): void {
    const padState = scratchPadStore.value;
    const markerState = markerStore.value;
    if (!padState || !markerState || padState.sections.length === 0) {
        return;
    }

    const newSections = [...padState.sections]
        .sort((alpha, buffer) => alpha.order - buffer.order)
        .map((state) => ({
            id: `section-committed-${crypto.randomUUID().slice(0, 8)}`,
            startBeat: state.startBeat,
            endBeat: state.endBeat,
            name: state.name,
            color: state.color,
        }));

    markerStore.set({ ...markerState, sections: newSections });
}
