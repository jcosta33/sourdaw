import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

type OutputDestinationTrack = {
    id: string;
    kind: string;
    outputId?: string | undefined;
    sends?: readonly { busId: string }[] | undefined;
};

/**
 * The buses a track's output can route to: never one whose output edge would
 * close a routing loop — the track itself or a bus that already feeds it —
 * which `setTrackOutput` refuses.
 */
export function listTrackOutputDestinations<Destination extends OutputDestinationTrack>(
    trackId: string,
    tracks: readonly Destination[]
): Destination[] {
    const sidechainRoutes = getAllSidechainRoutes();
    return tracks.filter(
        (bus) =>
            bus.kind === 'bus' &&
            !wouldCreateRoutingCycle({ sourceId: trackId, targetId: bus.id, tracks, sidechainRoutes })
    );
}
