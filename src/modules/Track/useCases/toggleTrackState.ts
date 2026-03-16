import { trackStore } from "../stores/trackStore";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import { startInputMonitoring, stopInputMonitoring } from "#/modules/AudioEngine/useCases/audioRecorder";
import { setMidiInputTrack } from "#/modules/AudioEngine/useCases/webMidiInput";

const savedGains = new Map<string, number>();

export const muteTrack = (trackId: string, muted: boolean): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, muted } : t,
        ),
    });

    audioEngine.setTrackMute(trackId, muted);
    applySoloLogic();
};

export const soloTrack = (trackId: string, soloed: boolean): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, soloed } : t,
        ),
    });

    applySoloLogic();
};

export const clearSolos = (): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({ ...t, soloed: false })),
    });
    applySoloLogic();
};

export const soloTrackExclusive = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            soloed: t.id === trackId,
        })),
    });

    applySoloLogic();
};

export const selectTrack = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({ ...state, selectedTrackId: trackId });

    const track = state.tracks.find((t) => t.id === trackId);
    if (track && track.kind === "midi") {
        setMidiInputTrack(trackId);
    }
};

export const reorderTrack = (trackId: string, newIndex: number): void => {
    const state = trackStore.value;
    if (!state) return;

    const tracks = [...state.tracks];
    const currentIndex = tracks.findIndex((t) => t.id === trackId);
    if (currentIndex < 0) return;

    const [track] = tracks.splice(currentIndex, 1);
    tracks.splice(Math.max(0, Math.min(tracks.length, newIndex)), 0, track!);

    trackStore.set({ ...state, tracks });
};

export const hideTrack = (trackId: string, hidden: boolean): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, hidden } : t,
        ),
    });
};

export const disableTrack = (trackId: string, disabled: boolean): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, disabled } : t,
        ),
    });
    if (disabled) {
        audioEngine.setTrackMute(trackId, true);
    } else {
        const track = state.tracks.find((t) => t.id === trackId);
        audioEngine.setTrackMute(trackId, track?.muted ?? false);
    }
};

export const setTrackHeight = (trackId: string, height: number): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, height: Math.max(30, Math.min(300, height)) } : t,
        ),
    });
};

export const setTrackOutput = (trackId: string, outputId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, outputId } : t,
        ),
    });
    audioEngine.setTrackOutput(trackId, outputId);
};

export const setAutomationMode = (trackId: string, mode: "read" | "write" | "touch" | "latch" | "off"): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, automationMode: mode } : t,
        ),
    });
};

export const foldTrack = (trackId: string, folded: boolean): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, collapsed: folded } : t,
        ),
    });
};

export const groupTracks = (trackIds: string[], _name: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    const groupId = `group-${Date.now()}`;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            trackIds.includes(t.id) ? { ...t, groupId } : t,
        ),
    });
};

export const ungroupTracks = (groupId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.groupId === groupId ? { ...t, groupId: null } : t,
        ),
    });
};

export const toggleSoloSafe = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, soloSafe: !t.soloSafe } : t,
        ),
    });
    applySoloLogic();
};

export const toggleInputMonitoring = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return;
    }
    const newValue = track.inputMonitoring === "on" ? "off" : "on";
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, inputMonitoring: newValue } : t,
        ),
    });
    if (newValue === "on") {
        void startInputMonitoring(trackId);
    } else {
        stopInputMonitoring();
    }
};

import type { Track } from "../models/Track";

const isRoutedToSoloedTrack = (track: Track, allTracks: Track[], visited = new Set<string>()): boolean => {
    if (track.outputId === "master") return false;
    if (visited.has(track.id)) return false;
    visited.add(track.id);
    const outputTrack = allTracks.find((t) => t.id === track.outputId);
    if (!outputTrack) return false;
    if (outputTrack.soloed) return true;
    return isRoutedToSoloedTrack(outputTrack, allTracks, visited);
};

const applySoloLogic = (): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const soloMode = workspaceStore.value?.soloMode ?? "sip";
    const anySoloed = state.tracks.some((t) => t.soloed);

    for (const track of state.tracks) {
        if (track.kind === "folder") {
            continue;
        }

        if (!anySoloed) {
            if (soloMode === "pfl" && savedGains.has(track.id)) {
                audioEngine.setTrackGain(track.id, savedGains.get(track.id)!);
                savedGains.delete(track.id);
            }
            audioEngine.setTrackMute(track.id, track.muted);
            continue;
        }

        if (track.soloSafe) {
            audioEngine.setTrackMute(track.id, track.muted);
            continue;
        }

        const routedToSoloed = isRoutedToSoloedTrack(track, state.tracks);

        if (soloMode === "pfl" && track.soloed) {
            if (!savedGains.has(track.id)) {
                savedGains.set(track.id, track.gain);
            }
            audioEngine.setTrackGain(track.id, 1.0);
            audioEngine.setTrackMute(track.id, false);
        } else if (soloMode === "pfl" && !track.soloed) {
            audioEngine.setTrackMute(track.id, !routedToSoloed);
        } else {
            const shouldMute = !track.soloed && !routedToSoloed;
            audioEngine.setTrackMute(track.id, shouldMute || track.muted);
        }
    }
};
