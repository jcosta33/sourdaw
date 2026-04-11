import { setWorkspaceMode as setWorkspaceModeImpl } from '#/modules/Workspace/useCases';

export function setWorkspaceMode(...args: Parameters<typeof setWorkspaceModeImpl>) {
    return setWorkspaceModeImpl(...args);
}