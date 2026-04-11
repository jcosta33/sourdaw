import { scratchPadStore } from '../../../stores/scratchPadStore';
import { createScratchPadSection } from '../../../models/ScratchPadSection';

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