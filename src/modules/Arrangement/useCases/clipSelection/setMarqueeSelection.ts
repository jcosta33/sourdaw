import { clipSelectionStore, type MarqueeSelection } from '../../stores/clipSelectionStore';

export function setMarqueeSelection(selection: MarqueeSelection | null): void {
    const current = clipSelectionStore.value;
    if (!current) {
        return;
    }
    clipSelectionStore.set({ ...current, marqueeSelection: selection });
}
