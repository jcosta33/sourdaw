import { scratchPadStore } from '../../../stores/scratchPadStore';

export function reorderScratchPadSection(sectionId: string, direction: 'left' | 'right'): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    const sections = [...state.sections].sort((alpha, buffer) => alpha.order - buffer.order);
    const index = sections.findIndex((state1) => state1.id === sectionId);
    if (index < 0) {
        return;
    }
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) {
        return;
    }

    const temp = sections[index]!;
    sections[index] = sections[targetIndex]!;
    sections[targetIndex] = temp;

    let beat = 0;
    const reordered = sections.map((state1, index1) => {
        const duration = state1.endBeat - state1.startBeat;
        const updated = { ...state1, order: index1, startBeat: beat, endBeat: beat + duration };
        beat += duration;
        return updated;
    });
    scratchPadStore.set({ sections: reordered });
}
