import { createScratchPadSectionId } from '../../../models/ScratchPadSection';
import { markerStore } from '../../../stores/markerStore';

/** One fresh pad section id for each section a capture of the live arrangement would copy. */
export function createScratchPadCaptureSectionIds(): string[] {
    const sectionCount = markerStore.value?.sections.length ?? 0;
    return Array.from({ length: sectionCount }, () => createScratchPadSectionId());
}
