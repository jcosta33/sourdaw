import { type Track } from '../models/Track';

export type SoloMode = 'sip' | 'afl' | 'pfl';

export type SoloLogicAction =
    { type: 'setGain'; trackId: string; gain: number } | { type: 'setMute'; trackId: string; muted: boolean };

export type ApplySoloLogicInput = {
    tracks: readonly Track[];
    soloMode: SoloMode;
    savedGains: ReadonlyMap<string, number>;
    liveStripTrackIds: ReadonlySet<string>;
};

export type ApplySoloLogicOutput = {
    actions: SoloLogicAction[];
    savedGains: ReadonlyMap<string, number>;
    /**
     * FX-8 — the tracks solo is silencing *because they are not being listened
     * to*, as opposed to the tracks the user muted by hand. `actions` cannot
     * carry that distinction: a `setMute` is `soloMuted || track.muted`, so the
     * two reasons arrive collapsed into one boolean.
     *
     * They must be told apart because they act at different points of the
     * channel strip. An individual mute is downstream of the pre-fader tap, so a
     * pre-fader (cue) send keeps feeding its bus — that is what "pre-fader"
     * means and the whole reason cue sends are wired that way. Solo-in-place is
     * not a mix state at all; it is "play me only this", so a gated track must
     * stop feeding *everything*, return buses included, or a solo still carries
     * the reverb tails of the material it was supposed to isolate.
     */
    soloGatedTrackIds: ReadonlySet<string>;
};

function isRoutedToSoloedTrack(
    track: Track,
    allTracks: readonly Track[],
    liveStripTrackIds: ReadonlySet<string>,
    visited = new Set<string>()
): boolean {
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
    if (outputTrack.soloed && liveStripTrackIds.has(outputTrack.id)) {
        return true;
    }
    return isRoutedToSoloedTrack(outputTrack, allTracks, liveStripTrackIds, visited);
}

// Authoritative solo/mute planner for the live engine. The offline exporter does
// not re-derive this math: `stores/effectiveAudibility` projects this same plan
// into a per-track audibility read model that the export path consumes, so live
// monitoring and export agree on which tracks are audible (OE-4).
export function applySoloLogic({
    tracks,
    soloMode,
    savedGains,
    liveStripTrackIds,
}: ApplySoloLogicInput): ApplySoloLogicOutput {
    const nextSavedGains = new Map(savedGains);
    const actions: SoloLogicAction[] = [];
    const soloGatedTrackIds = new Set<string>();
    const anySoloed = tracks.some(
        (track) => track.kind !== 'master' && track.soloed && liveStripTrackIds.has(track.id)
    );

    for (const track of tracks) {
        if (!liveStripTrackIds.has(track.id) || track.kind === 'master') {
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

        const routedToSoloed = isRoutedToSoloedTrack(track, tracks, liveStripTrackIds);

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

        // Solo-safe and soloed tracks returned above or are explicitly audible;
        // everything else that solo is silencing is gated. Reached only while a
        // solo is engaged, so an unsoloed session gates nothing.
        if (!track.soloed && !routedToSoloed) {
            soloGatedTrackIds.add(track.id);
        }
    }

    return { actions, savedGains: nextSavedGains, soloGatedTrackIds };
}
