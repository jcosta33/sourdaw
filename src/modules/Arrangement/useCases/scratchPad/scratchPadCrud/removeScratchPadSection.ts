import { scratchPadStore } from '../../../stores/scratchPadStore';

export function removeScratchPadSection(sectionId: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    const remaining = state.sections.filter((s) => s.id !== sectionId).map((s, i) => ({ ...s, order: i }));
    scratchPadStore.set({ sections: remaining });
}
