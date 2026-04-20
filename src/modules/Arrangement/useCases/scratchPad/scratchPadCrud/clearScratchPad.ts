import { scratchPadStore } from '../../../stores/scratchPadStore';

export function clearScratchPad(): void {
    scratchPadStore.set({ sections: [] });
}
