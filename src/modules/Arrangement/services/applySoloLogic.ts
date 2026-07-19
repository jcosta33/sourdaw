import { type Track } from '../models/Track';

export type SoloMode = 'sip' | 'afl' | 'pfl';

export type SoloLogicAction =
    { type: 'setGain'; trackId: string; gain: number } | { type: 'setMute'; trackId: string; muted: boolean };

export type ApplySoloLogicInput = {
    tracks: readonly Track[];
    soloMode: SoloMode;
    savedGains: ReadonlyMap<string, number>;
};

export type ApplySoloLogicOutput = {
    actions: SoloLogicAction[];
    savedGains: ReadonlyMap<string, number>;
};

function isRoutedToSoloedTrack(track: Track, allTracks: readonly Track[], visited = new Set<string>()): boolean {
    if (track.outputId === 'master') {
        return false;
    }
    if (visited.has(track.id)) {
        return false;
    }
    visited.add(track.id);
    const outputTrack = allTracks.find((candidate) => candidate.id === track.outputId);
    if (!outputTrack) {
        return false;
    }
    if (outputTrack.soloed) {
        return true;
    }
    return isRoutedToSoloedTrack(outputTrack, allTracks, visited);
}

export function applySoloLogic({ tracks, soloMode, savedGains }: ApplySoloLogicInput): ApplySoloLogicOutput {
    const nextSavedGains = new Map(savedGains);
    const actions: SoloLogicAction[] = [];
    const anySoloed = tracks.some((track) => track.soloed);

    for (const track of tracks) {
        if (track.kind === 'folder' || track.kind === 'master') {
            continue;
        }

        if (!anySoloed) {
            if (soloMode === 'pfl' && nextSavedGains.has(track.id)) {
                const savedGain = nextSavedGains.get(track.id);
                if (savedGain !== undefined) {
                    actions.push({ type: 'setGain', trackId: track.id, gain: savedGain });
                }
                nextSavedGains.delete(track.id);
            }
            actions.push({ type: 'setMute', trackId: track.id, muted: track.muted });
            continue;
        }

        if (track.soloSafe) {
            actions.push({ type: 'setMute', trackId: track.id, muted: track.muted });
            continue;
        }

        const routedToSoloed = isRoutedToSoloedTrack(track, tracks);

        if (soloMode === 'pfl' && track.soloed) {
            if (!nextSavedGains.has(track.id)) {
                nextSavedGains.set(track.id, track.gain);
            }
            actions.push({ type: 'setGain', trackId: track.id, gain: 1.0 });
            actions.push({ type: 'setMute', trackId: track.id, muted: false });
        } else if (soloMode === 'pfl' && !track.soloed) {
            actions.push({ type: 'setMute', trackId: track.id, muted: !routedToSoloed });
        } else {
            const shouldMute = !track.soloed && !routedToSoloed;
            actions.push({ type: 'setMute', trackId: track.id, muted: shouldMute || track.muted });
        }
    }

    return { actions, savedGains: nextSavedGains };
}
