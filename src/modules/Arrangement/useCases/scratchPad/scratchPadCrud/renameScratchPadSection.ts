import { scratchPadStore } from '../../../stores/scratchPadStore';

export function renameScratchPadSection(sectionId: string, name: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: state.sections.map((state1) => (state1.id === sectionId ? { ...state1, name } : state1)) });
}
