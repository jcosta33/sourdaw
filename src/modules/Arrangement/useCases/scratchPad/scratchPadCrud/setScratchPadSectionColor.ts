import { scratchPadStore } from '../../../stores/scratchPadStore';

export function setScratchPadSectionColor(sectionId: string, color: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: state.sections.map((state1) => (state1.id === sectionId ? { ...state1, color } : state1)) });
}
