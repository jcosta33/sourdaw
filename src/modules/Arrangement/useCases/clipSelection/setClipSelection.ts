import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';

export function setClipSelection(clipIds: string[]): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    clipSelectionStore.set({ ...current, selectedClipId: clipIds[0] ?? null, selectedClipIds: clipIds });
}
