import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { clearDeviceSelection } from '../deviceSelection/clearDeviceSelection';

export function selectClip(clipId: string): void {
    clearDeviceSelection();
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    if (current.selectedClipIds.includes(clipId)) {
        clipSelectionStore.set({ ...current, selectedClipId: clipId });
        return;
    }
    clipSelectionStore.set({ ...current, selectedClipId: clipId, selectedClipIds: [clipId] });
}
