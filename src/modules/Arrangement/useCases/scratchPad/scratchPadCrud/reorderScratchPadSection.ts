import { scratchPadStore } from '../../../stores/scratchPadStore';

import { projectScratchPadSectionReorder } from './projectScratchPadSectionReorder';

export function reorderScratchPadSection(sectionId: string, direction: 'left' | 'right'): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    const reordered = projectScratchPadSectionReorder(state.sections, sectionId, direction);
    if (reordered === state.sections) {
        return;
    }
    scratchPadStore.set({ sections: [...reordered] });
}
