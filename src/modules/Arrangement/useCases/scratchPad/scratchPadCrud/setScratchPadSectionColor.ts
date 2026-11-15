import { scratchPadStore } from '../../../stores/scratchPadStore';

import { projectScratchPadSectionColor } from './projectScratchPadSectionColor';

export function setScratchPadSectionColor(sectionId: string, color: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: projectScratchPadSectionColor(state.sections, sectionId, color) });
}
