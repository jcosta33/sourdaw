import {
    getTrackState,
    updateTrack,
    mapAllTracks,
    updateTrackState,
    getTrackById,
} from '../repositories/trackRepository';
import {
    setTrackMute as engineSetTrackMute,
    setTrackGain as engineSetTrackGain,
    setTrackOutput as engineSetTrackOutput,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { getWorkspaceStoreValue as getWorkspaceState } from '#/modules/Workspace/useCases/workspaceQueries';
import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine/useCases/audioRecorder';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases/webMidiInput';
import { type Track } from '../models/Track';

const savedGains = new Map<string, number>();

export function muteTrack(trackId: string, muted: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, muted }));
    engineSetTrackMute(trackId, muted);
    applySoloLogic();
}

export function soloTrack(trackId: string, soloed: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, soloed }));
    applySoloLogic();
}

export function clearSolos(): void {
    mapAllTracks((t) => ({ ...t, soloed: false }));
    applySoloLogic();
}

export function soloTrackExclusive(trackId: string): void {
    mapAllTracks((t) => ({ ...t, soloed: t.id === trackId }));
    applySoloLogic();
}

export function selectTrack(trackId: string): void {
    updateTrackState({ selectedTrackId: trackId });

    const track = getTrackById(trackId);
    if (track && track.kind === 'midi') {
        setMidiInputTrack(trackId);
    }
}

export function reorderTrack(trackId: string, newIndex: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const tracks = [...state.tracks];
    const currentIndex = tracks.findIndex((t) => t.id === trackId);
    if (currentIndex < 0) {
        return;
    }

    const [track] = tracks.splice(currentIndex, 1);
    tracks.splice(Math.max(0, Math.min(tracks.length, newIndex)), 0, track!);

    updateTrackState({ tracks });
}

export function hideTrack(trackId: string, hidden: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, hidden }));
}

export function disableTrack(trackId: string, disabled: boolean): void {
    const track = getTrackById(trackId);
    updateTrack(trackId, (t) => ({ ...t, disabled }));

    if (disabled) {
        engineSetTrackMute(trackId, true);
    } else {
        engineSetTrackMute(trackId, track?.muted ?? false);
    }
}

export function setTrackHeight(trackId: string, height: number): void {
    updateTrack(trackId, (t) => ({ ...t, height: Math.max(30, Math.min(300, height)) }));
}

export function setTrackOutput(trackId: string, outputId: string): void {
    updateTrack(trackId, (t) => ({ ...t, outputId }));
    engineSetTrackOutput(trackId, outputId);
}

export function setAutomationMode(trackId: string, mode: 'read' | 'write' | 'touch' | 'latch' | 'off'): void {
    updateTrack(trackId, (t) => ({ ...t, automationMode: mode }));
}

export function foldTrack(trackId: string, folded: boolean): void {
    updateTrack(trackId, (t) => ({ ...t, collapsed: folded }));
}

export function groupTracks(trackIds: string[], _name: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }
    const groupId = `group-${Date.now()}`;
    mapAllTracks((t) => (trackIds.includes(t.id) ? { ...t, groupId } : t));
}

export function ungroupTracks(groupId: string): void {
    mapAllTracks((t) => (t.groupId === groupId ? { ...t, groupId: null } : t));
}

export function toggleSoloSafe(trackId: string): void {
    updateTrack(trackId, (t) => ({ ...t, soloSafe: !t.soloSafe }));
    applySoloLogic();
}

export function toggleInputMonitoring(trackId: string): void {
    const track = getTrackById(trackId);
    if (!track) {
        return;
    }
    const newValue = track.inputMonitoring === 'on' ? 'off' : 'on';
    updateTrack(trackId, (t) => ({ ...t, inputMonitoring: newValue }));

    if (newValue === 'on') {
        void startInputMonitoring(trackId);
    } else {
        stopInputMonitoring();
    }
}

function isRoutedToSoloedTrack(track: Track, allTracks: Track[], visited = new Set<string>()): boolean {
    if (track.outputId === 'master') {
        return false;
    }
    if (visited.has(track.id)) {
        return false;
    }
    visited.add(track.id);
    const outputTrack = allTracks.find((t) => t.id === track.outputId);
    if (!outputTrack) {
        return false;
    }
    if (outputTrack.soloed) {
        return true;
    }
    return isRoutedToSoloedTrack(outputTrack, allTracks, visited);
}

function applySoloLogic(): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const soloMode = getWorkspaceState()?.soloMode ?? 'sip';
    const anySoloed = state.tracks.some((t) => t.soloed);

    for (const track of state.tracks) {
        if (track.kind === 'folder') {
            continue;
        }

        if (!anySoloed) {
            if (soloMode === 'pfl' && savedGains.has(track.id)) {
                engineSetTrackGain(track.id, savedGains.get(track.id)!);
                savedGains.delete(track.id);
            }
            engineSetTrackMute(track.id, track.muted);
            continue;
        }

        if (track.soloSafe) {
            engineSetTrackMute(track.id, track.muted);
            continue;
        }

        const routedToSoloed = isRoutedToSoloedTrack(track, state.tracks);

        if (soloMode === 'pfl' && track.soloed) {
            if (!savedGains.has(track.id)) {
                savedGains.set(track.id, track.gain);
            }
            engineSetTrackGain(track.id, 1.0);
            engineSetTrackMute(track.id, false);
        } else if (soloMode === 'pfl' && !track.soloed) {
            engineSetTrackMute(track.id, !routedToSoloed);
        } else {
            const shouldMute = !track.soloed && !routedToSoloed;
            engineSetTrackMute(track.id, shouldMute || track.muted);
        }
    }
}
