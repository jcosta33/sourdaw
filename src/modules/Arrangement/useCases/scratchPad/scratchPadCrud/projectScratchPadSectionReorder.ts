import { type ScratchPadSection } from '../../../models/ScratchPadSection';

// Returns the input rows untouched when the section is unknown or already at the edge.
export function projectScratchPadSectionReorder(
    current: readonly ScratchPadSection[],
    sectionId: string,
    direction: 'left' | 'right'
): readonly ScratchPadSection[] {
    const sections = [...current].sort((alpha, buffer) => alpha.order - buffer.order);
    const index = sections.findIndex((section) => section.id === sectionId);
    if (index < 0) {
        return current;
    }
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) {
        return current;
    }

    const temp = sections[index]!;
    sections[index] = sections[targetIndex]!;
    sections[targetIndex] = temp;

    let beat = 0;
    return sections.map((section, sectionIndex) => {
        const duration = section.endBeat - section.startBeat;
        const updated = { ...section, order: sectionIndex, startBeat: beat, endBeat: beat + duration };
        beat += duration;
        return updated;
    });
}
