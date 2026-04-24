import { workspaceStore } from '#/modules/Workspace/stores';

export function getSelectedClipIds(): string[] {
    const ws = workspaceStore.value;
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
