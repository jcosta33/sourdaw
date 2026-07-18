import { clipSelectionStore, defaultClipSelectionState, type MarqueeSelection } from '../../stores/clipSelectionStore';

export function setMarqueeSelection(selection: MarqueeSelection | null): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    clipSelectionStore.set({ ...current, marqueeSelection: selection });
}
