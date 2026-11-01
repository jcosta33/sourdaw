import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';

import { resolvePrimaryClip } from './resolvePrimaryClip';

export function selectAllClips(getAllClipIds: () => string[]): void {
    const current = clipSelectionStore.value ?? defaultClipSelectionState;
    const selectedClipIds = getAllClipIds();
    clipSelectionStore.set({
        ...current,
        selectedClipIds,
        // Several commands act on the primary alone, so a many-clip Select All keeps none.
        selectedClipId: resolvePrimaryClip(selectedClipIds, null),
    });
}
