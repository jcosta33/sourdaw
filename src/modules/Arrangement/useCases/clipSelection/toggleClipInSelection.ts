import { clipSelectionStore } from '../../stores/clipSelectionStore';
import { clearDeviceSelection } from '../deviceSelection/clearDeviceSelection';
import { resolvePrimaryClip } from './resolvePrimaryClip';

function resolvePrimaryAfterRemoval(
    currentPrimary: string | null,
    removedClipId: string,
    remainingIds: readonly string[]
): string | null {
    if (currentPrimary !== removedClipId) {
        return currentPrimary;
    }
    return remainingIds.at(-1) ?? null;
}

export function toggleClipInSelection(clipId: string): void {
    const current = clipSelectionStore.value;
    if (!current) {
        return;
    }
    clearDeviceSelection();
    const ids = new Set(current.selectedClipIds);
    if (!ids.has(clipId)) {
        ids.add(clipId);
        clipSelectionStore.set({ ...current, selectedClipId: clipId, selectedClipIds: [...ids] });
        return;
    }
    ids.delete(clipId);
    const remainingIds = [...ids];
    clipSelectionStore.set({
        ...current,
        selectedClipId: resolvePrimaryClip(
            remainingIds,
            resolvePrimaryAfterRemoval(current.selectedClipId, clipId, remainingIds)
        ),
        selectedClipIds: remainingIds,
    });
}
