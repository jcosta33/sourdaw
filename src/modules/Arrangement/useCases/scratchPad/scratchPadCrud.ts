import { scratchPadStore } from '../../stores/scratchPadStore';
import { createScratchPadSection } from '../../models/ScratchPadSection';

export type ScratchPadSection = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
    order: number;
};

export function addScratchPadSection(startBeat: number, endBeat: number, name: string, color: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    const order = state.sections.length;
    scratchPadStore.set({
        sections: [...state.sections, createScratchPadSection(startBeat, endBeat, name, color, order)],
    });
}

export function removeScratchPadSection(sectionId: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    const remaining = state.sections.filter((s) => s.id !== sectionId).map((s, i) => ({ ...s, order: i }));
    scratchPadStore.set({ sections: remaining });
}

export function renameScratchPadSection(sectionId: string, name: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: state.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)) });
}

export function setScratchPadSectionColor(sectionId: string, color: string): void {
    const state = scratchPadStore.value;
    if (!state) {
        return;
    }
    scratchPadStore.set({ sections: state.sections.map((s) => (s.id === sectionId ? { ...s, color } : s)) });
}

export function clearScratchPad(): void {
    scratchPadStore.set({ sections: [] });
}

export function reorderScratchPadSection(sectionId: string, direction: 'left' | 'right'): void {
    const state = scratchPadStore.value;
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
    scratchPadStore.set({ sections: reordered });
}
