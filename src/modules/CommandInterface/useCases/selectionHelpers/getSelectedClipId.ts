import { clipSelectionStore } from '#/modules/Arrangement/stores';

export function getSelectedClipId(): string | null {
    const ws = clipSelectionStore.value;
    if (!ws) {
        return null;
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds[0] ?? null;
    }
    return ws.selectedClipId;
}
