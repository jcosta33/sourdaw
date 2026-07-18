import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';

export function clearClipSelection(): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    clipSelectionStore.set({ ...current, selectedClipId: null, selectedClipIds: [] });
}
