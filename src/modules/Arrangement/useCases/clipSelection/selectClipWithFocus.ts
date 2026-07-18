import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';

export function selectClipWithFocus(clipId: string): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    clipSelectionStore.set({ ...current, selectedClipId: clipId, selectedClipIds: [clipId] });
}
