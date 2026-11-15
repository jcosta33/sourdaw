import { type ScratchPadSection } from '../../../models/ScratchPadSection';

export function projectScratchPadSectionRename(
    sections: readonly ScratchPadSection[],
    sectionId: string,
    name: string
): ScratchPadSection[] {
    return sections.map((section) => (section.id === sectionId ? { ...section, name } : section));
}
