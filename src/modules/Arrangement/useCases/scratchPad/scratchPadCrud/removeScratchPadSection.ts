import { scratchPadStore } from '../../../stores/scratchPadStore';

import { projectScratchPadSectionRemoval } from './projectScratchPadSectionRemoval';

export function removeScratchPadSection(sectionId: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: projectScratchPadSectionRemoval(state.sections, sectionId) });
}
