/**
 * Solo engine logic — applies SIP (Solo In Place) or PFL (Pre-Fader Listen)
 * mute/gain changes to the audio engine based on which tracks are soloed.
 *
 * Shared by muteTrack, soloTrack, clearSolos, soloTrackExclusive, toggleSoloSafe.
 */

import { getTrackState } from '#/modules/Arrangement/useCases/trackQueries/trackStoreAccess';
import {
    setTrackMute as engineSetTrackMute,
    setTrackGain as engineSetTrackGain,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { getWorkspaceState } from '#/modules/Workspace/useCases/workspaceQueries';
import { type Track } from '#/modules/Arrangement/models/Track';

const savedGains = new Map<string, number>();

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

export function applySoloLogic(): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const soloMode = getWorkspaceState()?.soloMode ?? 'sip';
    const anySoloed = state.tracks.some((t) => t.soloed);

    for (const track of state.tracks) {
        if (track.kind === 'folder' || track.kind === 'master') {
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
