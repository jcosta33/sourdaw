import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';

import { resolvePrimaryClip } from './resolvePrimaryClip';

export function selectAllClips(getAllClipIds: () => string[]): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    const selectedClipIds = getAllClipIds();
    clipSelectionStore.set({
        ...current,
        selectedClipIds,
        selectedClipId: resolvePrimaryClip(selectedClipIds, current.selectedClipId),
    });
}
