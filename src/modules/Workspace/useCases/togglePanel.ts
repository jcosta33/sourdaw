import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspaceRepository';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { type SoloMode } from '../models/WorkspaceState';

export function setSoloMode(soloMode: SoloMode): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ soloMode });
}

export function toggleSidebar(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ sidebarOpen: !current.sidebarOpen });
}

export function toggleInspector(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ inspectorOpen: !current.inspectorOpen });
}

export function toggleChatPanel(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ chatPanelOpen: !current.chatPanelOpen });
}

export function toggleMixer(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mixerOpen: !current.mixerOpen });
}

export function toggleAutomationPanel(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ automationPanelOpen: !current.automationPanelOpen });
}

export function toggleTrackList(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ trackListOpen: !current.trackListOpen });
}

export function setSnapValue(value: number): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ snapValue: value });
}

export function zoomToFit(): void {
    document.dispatchEvent(new CustomEvent('webdaw:zoom-to-fit'));
}

export function zoomToSelection(): void {
    const ws = getWorkspaceState();
    const state = trackStore.value;
    if (!ws || !state) {
        return;
    }

    const selectedIds =
        ws.selectedClipIds.length > 0 ? ws.selectedClipIds : ws.selectedClipId ? [ws.selectedClipId] : [];

    if (selectedIds.length === 0) {
        return;
    }

    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (selectedIds.includes(clip.id)) {
                if (clip.startBeat < minStart) {
                    minStart = clip.startBeat;
                }
                if (clip.endBeat > maxEnd) {
                    maxEnd = clip.endBeat;
                }
            }
        }
    }

    if (minStart === Infinity || maxEnd === -Infinity || maxEnd <= minStart) {
        return;
    }

    document.dispatchEvent(
        new CustomEvent('webdaw:zoom-to-selection', {
            detail: { startBeat: minStart, endBeat: maxEnd },
        })
    );
}



export function cycleAutomationVisibility(): void {
    document.dispatchEvent(new CustomEvent('webdaw:show-automation-tab'));
}
