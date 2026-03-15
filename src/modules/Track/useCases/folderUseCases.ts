import { trackStore } from "../stores/trackStore";
import { createTrack } from "../models/Track";

export const createFolder = (name: string): void => {
    const state = trackStore.value;
    if (!state) return;

    const folder = createTrack({ name, kind: "folder" });
    trackStore.set({
        ...state,
        tracks: [...state.tracks, folder],
    });
};

export const moveToFolder = (trackId: string, folderId: string | null): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, parentId: folderId } : t,
        ),
    });
};

export const toggleFolderCollapse = (folderId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === folderId ? { ...t, collapsed: !t.collapsed } : t,
        ),
    });
};

export const getVisibleTracks = () => {
    const state = trackStore.value;
    if (!state) return [];

    const collapsedFolders = new Set(
        state.tracks.filter((t) => t.kind === "folder" && t.collapsed).map((t) => t.id),
    );

    return state.tracks.filter((t) => {
        if (!t.parentId) return true;
        return !collapsedFolders.has(t.parentId);
    });
};
