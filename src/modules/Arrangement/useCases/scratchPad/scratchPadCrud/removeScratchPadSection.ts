import { scratchPadStore } from '../../../stores/scratchPadStore';

export function removeScratchPadSection(sectionId: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    const remaining = state.sections
        .filter((state1) => state1.id !== sectionId)
        .map((state1, index) => ({ ...state1, order: index }));
    scratchPadStore.set({ sections: remaining });
}
