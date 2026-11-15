import { type ScratchPadSection } from '../../../models/ScratchPadSection';

export function projectScratchPadSectionRemoval(
    sections: readonly ScratchPadSection[],
    sectionId: string
): ScratchPadSection[] {
    return sections
        .filter((section) => section.id !== sectionId)
        .map((section, index) => ({ ...section, order: index }));
}
