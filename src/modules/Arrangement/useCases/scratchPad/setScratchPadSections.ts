import { type ScratchPadSection } from '../../models/ScratchPadSection';
import { scratchPadStore } from '../../stores/scratchPadStore';

// Raw setter for the guarded restore path. The guard itself lives in the handler that
// calls this (`handleRestoreScratchPadState`) — this just writes the collection it decided on.
export function setScratchPadSections(sections: readonly ScratchPadSection[]): void {
    scratchPadStore.set({ sections: [...sections] });
}
