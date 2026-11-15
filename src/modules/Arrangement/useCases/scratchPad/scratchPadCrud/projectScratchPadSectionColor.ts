import { type ScratchPadSection } from '../../../models/ScratchPadSection';

export function projectScratchPadSectionColor(
    sections: readonly ScratchPadSection[],
    sectionId: string,
    color: string
): ScratchPadSection[] {
    return sections.map((section) => (section.id === sectionId ? { ...section, color } : section));
}
