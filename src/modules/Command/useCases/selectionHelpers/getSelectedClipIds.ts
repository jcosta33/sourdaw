import { clipSelectionStore } from '#/modules/Arrangement/stores';

export function getSelectedClipIds(): string[] {
    const ws = clipSelectionStore.value;
    if (!ws) {
        return [];
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds;
    }
    if (ws.selectedClipId) {
        return [ws.selectedClipId];
    }
    return [];
}
