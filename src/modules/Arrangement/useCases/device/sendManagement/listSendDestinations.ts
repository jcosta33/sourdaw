import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

type SendDestinationTrack = {
    id: string;
    kind: string;
    outputId?: string | undefined;
    sends?: readonly { busId: string }[] | undefined;
};

/**
 * The buses a track can send to: never the track itself and never a bus whose
 * send would close a routing loop — `setSend` refuses both. A bus the track
 * already sends to stays listed so that send can still be lowered or removed.
 */
export function listSendDestinations<T extends SendDestinationTrack>(trackId: string, tracks: readonly T[]): T[] {
    const sidechainRoutes = getAllSidechainRoutes();
    const existingBusIds = new Set(tracks.find((track) => track.id === trackId)?.sends?.map((send) => send.busId));
    return tracks.filter(
        (bus) =>
            bus.kind === 'bus' &&
            (existingBusIds.has(bus.id) ||
                !wouldCreateRoutingCycle({ sourceId: trackId, targetId: bus.id, tracks, sidechainRoutes }))
    );
}
