import { scratchPadStore } from '../../../stores/scratchPadStore';

import { projectScratchPadSectionRename } from './projectScratchPadSectionRename';

export function renameScratchPadSection(sectionId: string, name: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: projectScratchPadSectionRename(state.sections, sectionId, name) });
}
