import { scratchPadStore } from '../../../stores/scratchPadStore';

export function renameScratchPadSection(sectionId: string, name: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: state.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)) });
}