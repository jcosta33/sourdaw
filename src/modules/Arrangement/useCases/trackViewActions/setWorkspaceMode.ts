import { setWorkspaceMode as setWorkspaceModeImpl } from '#/modules/WorkspaceShell/useCases';

export function setWorkspaceMode(...args: Parameters<typeof setWorkspaceModeImpl>) {
    return setWorkspaceModeImpl(...args);
}
