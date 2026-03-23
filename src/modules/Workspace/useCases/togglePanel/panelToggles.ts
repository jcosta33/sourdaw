import { getWorkspaceState, updateWorkspaceState } from '../../repositories/workspaceRepository';
import { type SoloMode } from '../../models/WorkspaceState';

export function setSoloMode(soloMode: SoloMode): void {
    const current = getWorkspaceState();
    if (!current) { return; }
    updateWorkspaceState({ soloMode });
}

export function toggleSidebar(): void {
    const current = getWorkspaceState();
    if (!current) { return; }
    updateWorkspaceState({ sidebarOpen: !current.sidebarOpen });
}

export function toggleInspector(): void {
    const current = getWorkspaceState();
    if (!current) { return; }
    updateWorkspaceState({ inspectorOpen: !current.inspectorOpen });
}

export function toggleChatPanel(): void {
    const current = getWorkspaceState();
    if (!current) { return; }
    updateWorkspaceState({ chatPanelOpen: !current.chatPanelOpen });
}

export function toggleMixer(): void {
    const current = getWorkspaceState();
    if (!current) { return; }
    updateWorkspaceState({ mixerOpen: !current.mixerOpen });
}

export function toggleAutomationPanel(): void {
    const current = getWorkspaceState();
    if (!current) { return; }
    updateWorkspaceState({ automationPanelOpen: !current.automationPanelOpen });
}

export function toggleTrackList(): void {
    const current = getWorkspaceState();
    if (!current) { return; }
    updateWorkspaceState({ trackListOpen: !current.trackListOpen });
}

export function setSnapValue(value: number): void {
    const current = getWorkspaceState();
    if (!current) { return; }
    updateWorkspaceState({ snapValue: value });
}
