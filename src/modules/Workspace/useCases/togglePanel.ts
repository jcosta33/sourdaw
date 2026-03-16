import { workspaceStore } from "../stores/workspaceStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import type { SoloMode } from "../models/WorkspaceState";

export const setSoloMode = (soloMode: SoloMode): void => {
    const current = workspaceStore.value;
    if (!current) {
        return;
    }
    workspaceStore.set({ ...current, soloMode });
};

export const toggleSidebar = (): void => {
    const current = workspaceStore.value;
    if (!current) return;
    workspaceStore.set({ ...current, sidebarOpen: !current.sidebarOpen });
};

export const toggleInspector = (): void => {
    const current = workspaceStore.value;
    if (!current) return;
    workspaceStore.set({ ...current, inspectorOpen: !current.inspectorOpen });
};

export const toggleMixer = (): void => {
    const current = workspaceStore.value;
    if (!current) {
        return;
    }
    workspaceStore.set({ ...current, mixerOpen: !current.mixerOpen });
};

export const setSnapValue = (value: number): void => {
    const current = workspaceStore.value;
    if (!current) {
        return;
    }
    workspaceStore.set({ ...current, snapValue: value });
};

export const zoomToFit = (): void => {
    document.dispatchEvent(new CustomEvent("webdaw:zoom-to-fit"));
};

export const zoomToSelection = (): void => {
    const ws = workspaceStore.value;
    const state = trackStore.value;
    if (!ws || !state) {
        return;
    }

    const selectedIds = ws.selectedClipIds.length > 0
        ? ws.selectedClipIds
        : ws.selectedClipId
            ? [ws.selectedClipId]
            : [];

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

    document.dispatchEvent(new CustomEvent("webdaw:zoom-to-selection", {
        detail: { startBeat: minStart, endBeat: maxEnd },
    }));
};
