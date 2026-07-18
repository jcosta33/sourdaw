import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';

export function selectClip(clipId: string): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    clipSelectionStore.set({ ...current, selectedClipId: clipId });
}
