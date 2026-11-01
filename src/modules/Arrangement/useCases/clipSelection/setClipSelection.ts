import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { clearDeviceSelection } from '../deviceSelection/clearDeviceSelection';

export function setClipSelection(clipIds: string[]): void {
    if (clipIds.length > 0) {
        clearDeviceSelection();
    }
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    clipSelectionStore.set({ ...current, selectedClipId: clipIds[0] ?? null, selectedClipIds: clipIds });
}
