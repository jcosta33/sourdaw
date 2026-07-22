/**
 * Ensures all track and bus strips exist in the audio engine
 * and syncs their gain/pan/mute/solo/sends/devices from the store state.
 *
 * Used by startPlayback and toggleRecording before audio begins.
 */

import { shouldCreateLiveTrackStrip, trackStore } from '#/modules/Arrangement/stores';
import { projectTrackToLiveStrip } from '#/modules/Arrangement/useCases';
import { ensureBusStrip, setBusGain, wireSidechainRoutes } from '#/modules/Routing/useCases';

function hasAmbiguousBusOwner(tracks: NonNullable<typeof trackStore.value>['tracks']): boolean {
    return tracks.some(
        (track) => track.kind === 'bus' && tracks.filter((candidate) => candidate.id === track.id).length !== 1
    );
}

export function ensureTrackStrips(): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks || hasAmbiguousBusOwner(tracks)) {
        return;
    }
    const busTracks = tracks.filter((time) => time.kind === 'bus');
    for (const bus of busTracks) {
        ensureBusStrip(bus.id);
        setBusGain(bus.id, bus.gain);
    }

    for (const track of tracks) {
        if (!shouldCreateLiveTrackStrip(track)) {
            continue;
        }
        projectTrackToLiveStrip({ trackId: track.id, deferSidechainWiring: true });
    }

    // Re-wire persisted sidechain routes now that every track/bus strip and its
    // devices exist in the engine. Without this, a project saved with sidechain
    // routing loads with the routes in the store but never wired into the graph,
    // so the compression is silently absent. The engine ignores routes whose
    // target strip/device is missing, so this must run after the loop above.
    wireSidechainRoutes();
}
