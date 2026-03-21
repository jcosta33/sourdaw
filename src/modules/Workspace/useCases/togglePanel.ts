import { getWorkspaceState, updateWorkspaceState } from '../repositories/workspaceRepository';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { addAutomationLane } from '#/modules/Track/useCases/automationUseCases';
import { type SoloMode, type AutomationVisibility } from '../models/WorkspaceState';

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

const VISIBILITY_CYCLE: AutomationVisibility[] = ['hidden', 'overlay', 'panel'];

export function cycleAutomationVisibility(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const currentIdx = VISIBILITY_CYCLE.indexOf(current.automationVisibility ?? 'hidden');
    const nextIdx = (currentIdx + 1) % VISIBILITY_CYCLE.length;
    const next = VISIBILITY_CYCLE[nextIdx]!;

    // Auto-create default Volume sub-lanes when entering a visible mode
    let subLanes = current.automationSubLanes;
    if (next !== 'hidden') {
        const trackState = trackStore.value;
        if (trackState) {
            const updated = { ...subLanes };
            let changed = false;
            for (const track of trackState.tracks) {
                const existing = updated[track.id];
                if (!existing || existing.length === 0) {
                    updated[track.id] = ['gain'];
                    changed = true;
                    // Ensure the automation lane exists
                    const autoState = automationStore.value;
                    if (!autoState?.lanes.find((l) => l.trackId === track.id && l.parameterId === 'gain')) {
                        addAutomationLane(track.id, 'gain', 'Volume');
                    }
                }
            }
            if (changed) {
                subLanes = updated;
            }
        }
    }

    updateWorkspaceState({
        automationVisibility: next,
        automationPanelOpen: next === 'panel',
        automationSubLanes: subLanes,
    });
}
