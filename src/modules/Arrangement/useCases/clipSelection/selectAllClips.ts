import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';

export function selectAllClips(getAllClipIds: () => string[]): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    clipSelectionStore.set({ ...current, selectedClipIds: getAllClipIds(), selectedClipId: null });
}
