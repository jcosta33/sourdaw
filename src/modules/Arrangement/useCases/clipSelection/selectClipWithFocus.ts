import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { clearDeviceSelection } from '../deviceSelection/clearDeviceSelection';

export function selectClipWithFocus(clipId: string): void {
    clearDeviceSelection();
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    clipSelectionStore.set({ ...current, selectedClipId: clipId, selectedClipIds: [clipId] });
}
