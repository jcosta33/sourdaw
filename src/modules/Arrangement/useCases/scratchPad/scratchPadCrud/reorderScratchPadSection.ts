import { scratchPadStore } from '../../../stores/scratchPadStore';

export function reorderScratchPadSection(sectionId: string, direction: 'left' | 'right'): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    const sections = [...state.sections].sort((a, b) => a.order - b.order);
    const index = sections.findIndex((s) => s.id === sectionId);
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
    const reordered = sections.map((s, i) => {
        const duration = s.endBeat - s.startBeat;
        const updated = { ...s, order: i, startBeat: beat, endBeat: beat + duration };
        beat += duration;
        return updated;
    });
    scratchPadStore.set({ sections: reordered });
}