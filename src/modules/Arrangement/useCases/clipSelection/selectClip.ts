import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';

export function selectClip(clipId: string): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    if (current.selectedClipIds.includes(clipId)) {
        clipSelectionStore.set({ ...current, selectedClipId: clipId });
        return;
    }
    clipSelectionStore.set({ ...current, selectedClipId: clipId, selectedClipIds: [clipId] });
}
