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
import { ensureBusStrip, wireSidechainRoutes } from '#/modules/Routing/useCases';

function hasAmbiguousBusOwner(tracks: NonNullable<typeof trackStore.value>['tracks']): boolean {
    return tracks.some(
        (track) => track.kind === 'bus' && tracks.filter((candidate) => candidate.id === track.id).length !== 1
    );
}

type StripProjectionInput = Parameters<typeof projectTrackToLiveStrip>[0];
type ExternalPluginActivation = Parameters<NonNullable<StripProjectionInput['onExternalPluginActivation']>>[0];

export type EnsureTrackStripsResult =
    | {
          status: 'ready';
          externalPluginActivations: ExternalPluginActivation[];
      }
    | { status: 'failed'; reason: string };

/** Initializes output owners before their sources without publishing empty strips first. */
function orderLiveTracksForInitialization<TTrack extends { id: string; outputId: string }>(
    liveTracks: readonly TTrack[]
): TTrack[] {
    const tracksById = new Map<string, TTrack>();
    for (const track of liveTracks) {
        if (liveTracks.filter((candidate) => candidate.id === track.id).length === 1) {
            tracksById.set(track.id, track);
        }
    }
    const ordered: TTrack[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (track: TTrack): void => {
        if (visited.has(track.id) || visiting.has(track.id)) {
            return;
        }
        visiting.add(track.id);
        const target = tracksById.get(track.outputId);
        if (target) {
            visit(target);
        }
        visiting.delete(track.id);
        visited.add(track.id);
        ordered.push(track);
    };
    for (const track of liveTracks) {
        visit(track);
    }
    return ordered;
}

export function ensureTrackStrips(input?: { collectExternalPluginActivations?: boolean }): EnsureTrackStripsResult {
    applySoloLogic({ resetSavedGains: true, applyActions: false });
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return { status: 'failed', reason: 'Project tracks are unavailable' };
    }
    if (hasAmbiguousBusOwner(tracks)) {
        return { status: 'failed', reason: 'The project has an ambiguous bus owner' };
    }
    const busTracks = tracks.filter((track) => track.kind === 'bus');
    const liveTracks = tracks.filter(shouldCreateLiveTrackStrip);

    const externalPluginActivations: ExternalPluginActivation[] = [];
    for (const track of orderLiveTracksForInitialization(liveTracks)) {
        const projection: StripProjectionInput = {
            trackId: track.id,
            deferSidechainWiring: true,
            deferSends: true,
            activateDormantExternalPlugins: true,
        };
        if (input?.collectExternalPluginActivations) {
            projection.onExternalPluginActivation = (activation) => {
                externalPluginActivations.push(activation);
            };
        }
        const outcome = projectTrackToLiveStrip(projection);
        if (outcome?.acceptance !== 'accepted' || outcome.application !== 'applied') {
            return {
                status: 'failed',
                reason: outcome?.reason ?? `Track strip initialization did not produce an outcome for ${track.id}`,
            };
        }
    }

    // A facade or send can create an empty paired strip. Publish them only
    // after all full chains have been admitted, including later send targets.
    // BusNode shares the track fader: projection already restored gain and PFL,
    // so replaying raw bus gain here would overwrite the solo audition gain.
    for (const bus of busTracks) {
        ensureBusStrip(bus.id);
    }
    for (const track of liveTracks) {
        const routing = projectTrackToLiveStrip({ mode: 'sends', trackId: track.id });
        if (routing.status === 'rejected') {
            return { status: 'failed', reason: routing.reason };
        }
    }

    // Re-wire persisted sidechain routes now that every track/bus strip and its
    // devices exist in the engine. Without this, a project saved with sidechain
    // routing loads with the routes in the store but never wired into the graph,
    // so the compression is silently absent. The engine ignores routes whose
    // target strip/device is missing, so this must run after the loop above.
    wireSidechainRoutes();
    return { status: 'ready', externalPluginActivations };
}
