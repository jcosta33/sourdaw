import { inject } from '#/infra/di/inject';
import { scratchPadStore } from '../../stores/scratchPadStore';
import { createScratchPadSection } from '../../models/ScratchPadSection';

export type { ScratchPadSection } from '../../models/ScratchPadSection';

export const addScratchPadSection = inject({ scratchPadStore })(({ scratchPadStore: store }) => {
    return function addScratchPadSection(startBeat: number, endBeat: number, name: string, color: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        const order = state.sections.length;
        store.set({
            sections: [...state.sections, createScratchPadSection(startBeat, endBeat, name, color, order)],
        });
    };
});

export const removeScratchPadSection = inject({ scratchPadStore })(({ scratchPadStore: store }) => {
    return function removeScratchPadSection(sectionId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        const remaining = state.sections.filter((s) => s.id !== sectionId).map((s, i) => ({ ...s, order: i }));
        store.set({ sections: remaining });
    };
});

export const renameScratchPadSection = inject({ scratchPadStore })(({ scratchPadStore: store }) => {
    return function renameScratchPadSection(sectionId: string, name: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ sections: state.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)) });
    };
});

export const setScratchPadSectionColor = inject({ scratchPadStore })(({ scratchPadStore: store }) => {
    return function setScratchPadSectionColor(sectionId: string, color: string): void {
        const state = store.value;
        if (!state) {
            return;
        }
        store.set({ sections: state.sections.map((s) => (s.id === sectionId ? { ...s, color } : s)) });
    };
});

export const clearScratchPad = inject({ scratchPadStore })(({ scratchPadStore: store }) => {
    return function clearScratchPad(): void {
        store.set({ sections: [] });
    };
});

export const reorderScratchPadSection = inject({ scratchPadStore })(({ scratchPadStore: store }) => {
    return function reorderScratchPadSection(sectionId: string, direction: 'left' | 'right'): void {
        const state = store.value;
        if (!state) {
            return;
        }
        const sections = [...state.sections].sort((a, b) => a.order - b.order);
        const index = sections.findIndex((s) => s.id === sectionId);
        if (index < 0) {
            return;
        }
        const targetIndex = direction === 'left' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= sections.length) {
            return;
        }

        const temp = sections[index]!;
        sections[index] = sections[targetIndex]!;
        sections[targetIndex] = temp;

        let beat = 0;
        const reordered = sections.map((s, i) => {
            const duration = s.endBeat - s.startBeat;
            const updated = { ...s, order: i, startBeat: beat, endBeat: beat + duration };
            beat += duration;
            return updated;
        });
        store.set({ sections: reordered });
    };
});
