import { workspaceStore } from '#/modules/Workspace/stores';

export function getSelectedClipId(): string | null {
    const ws = workspaceStore.value;
    if (!ws) {
        return null;
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds[0] ?? null;
    }
    return ws.selectedClipId;
}
