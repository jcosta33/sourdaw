import { scratchPadStore } from '../../../stores/scratchPadStore';

export function setScratchPadSectionColor(sectionId: string, color: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: state.sections.map((s) => (s.id === sectionId ? { ...s, color } : s)) });
}
