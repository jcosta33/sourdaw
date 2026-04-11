import { getWorkspaceState } from '#/modules/Workspace/useCases';

export function getSelectedClipId(): string | null {
    const ws = getWorkspaceState();
    if (!ws) {
        return null;
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds[0] ?? null;
    }
    return ws.selectedClipId;
}