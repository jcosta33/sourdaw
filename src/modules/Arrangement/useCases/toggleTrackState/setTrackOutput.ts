import { logger } from '#/infra/logger/appLogger';
import { resolveToasterPadBinding, setTrackOutput as engineSetTrackOutput } from '#/modules/AudioEngine/useCases';
import { getAllSidechainRoutes } from '#/modules/Routing/useCases';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';

import { getAllTracks } from '../../repositories/track/getAllTracks';
import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';

export function setTrackOutput(trackId: string, outputId: string): boolean {
    const track = getTrackById(trackId);
    if (track && !getTrackEligibility(track.kind).acceptsOutput) {
        return false;
    }

    const targetTrack = getTrackById(outputId);
    if (targetTrack && !getTrackEligibility(targetTrack.kind).acceptsRoutingEndpoint) {
        return false;
    }

    // FX-2: `getDefaultDestination` resolves outputId one hop at a time with no
    // ancestry check, so bus A → bus B → bus A is wired without complaint and
    // then muted by the Web Audio cycle rule. Same guard, same boundary as the
    // send path — an output edge closes a loop just as readily.
    if (
        wouldCreateRoutingCycle({
            sourceId: trackId,
            targetId: outputId,
            tracks: getAllTracks(),
            sidechainRoutes: getAllSidechainRoutes(),
        })
    ) {
        logger.warn(
            `[setTrackOutput] Rejected output ${trackId} → ${outputId}: it would create a routing ` +
                'feedback loop. Pick a destination that does not route back to this track.'
        );
        return false;
    }
    updateTrack(trackId, (time) => ({ ...time, outputId }));
    const padBinding = resolveToasterPadBinding(getAllTracks(), trackId);
    if (padBinding) {
        engineSetTrackOutput(trackId, outputId, padBinding);
    } else {
        engineSetTrackOutput(trackId, outputId);
    }
    return true;
}
