import { getWorkspaceState } from '#/modules/Workspace/useCases';

export function getSelectedClipIds(): string[] {
    const ws = getWorkspaceState();
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