/**
 * Ensures all track and bus strips exist in the audio engine
 * and syncs their gain/pan/mute/solo/sends/devices from the store state.
 *
 * Used by startPlayback, toggleRecording, and the project-open rebuild. Instantiates
 * dormant native (external) plugins idempotently, so reopening a project restores their
 * state and repeated rebuilds (each Play/record) do not re-issue load/restore IPC.
 */

import { shouldCreateLiveTrackStrip, trackStore } from '#/modules/Arrangement/stores';
import { applySoloLogic, projectTrackToLiveStrip } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';
import { ensureBusStrip, setBusGain, wireSidechainRoutes } from '#/modules/Routing/useCases';

function hasAmbiguousBusOwner(tracks: NonNullable<typeof trackStore.value>['tracks']): boolean {
    return tracks.some(
        (track) => track.kind === 'bus' && tracks.filter((candidate) => candidate.id === track.id).length !== 1
    );
}

export function ensureTrackStrips(): void {
    applySoloLogic({ resetSavedGains: true, applyActions: false });
    const tracks = trackStore.value?.tracks;
    if (!tracks || hasAmbiguousBusOwner(tracks)) {
        return;
    }
    const busTracks = tracks.filter((track) => track.kind === 'bus');
    const liveTracks = tracks.filter(shouldCreateLiveTrackStrip);

    for (const bus of busTracks) {
        ensureBusStrip(bus.id);
    }

    for (const track of liveTracks) {
        ensureTrackStrip(track.id);
    }

    for (const bus of busTracks) {
        setBusGain(bus.id, bus.gain);
    }

    for (const track of liveTracks) {
        projectTrackToLiveStrip({
            trackId: track.id,
            deferSidechainWiring: true,
            activateDormantExternalPlugins: true,
        });
    }

    // Re-wire persisted sidechain routes now that every track/bus strip and its
    // devices exist in the engine. Without this, a project saved with sidechain
    // routing loads with the routes in the store but never wired into the graph,
    // so the compression is silently absent. The engine ignores routes whose
    // target strip/device is missing, so this must run after the loop above.
    wireSidechainRoutes();
}
