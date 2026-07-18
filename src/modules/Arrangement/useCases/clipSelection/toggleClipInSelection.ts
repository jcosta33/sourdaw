import { clipSelectionStore } from '../../stores/clipSelectionStore';

export function toggleClipInSelection(clipId: string): void {
    const current = clipSelectionStore.value;
    if (!current) {
        return;
    }
    const ids = new Set(current.selectedClipIds);
    if (ids.has(clipId)) {
        ids.delete(clipId);
    } else {
        ids.add(clipId);
    }
    clipSelectionStore.set({ ...current, selectedClipId: clipId, selectedClipIds: [...ids] });
}
