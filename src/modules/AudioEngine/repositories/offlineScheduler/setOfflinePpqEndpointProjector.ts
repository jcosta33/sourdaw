import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
    type OfflineBeatAtSecondsFromAnchor,
} from './offlinePpqEndpointProjectorState';

type SetOfflinePpqEndpointProjectorInput = {
    project: OfflinePpqEndpointProjector;
    /**
     * Required, and deliberately not defaulted. Every other missing offline
     * dependency fails loudly; a missing tempo resolver would instead render
     * every clip's source offset at the default tempo, which is right only for
     * a project with no tempo map and silently wrong for every project that
     * has one. A bounce at the wrong rate is indistinguishable from a correct
     * one until someone listens, so the composition root must name it.
     */
    resolveTempoAtBeat: OfflineTempoAtBeatResolver;
    /** Required for moving modulation/layers; lane-only recording needs only the forward map. */
    beatAtSecondsFromAnchor?: OfflineBeatAtSecondsFromAnchor;
};

export function setOfflinePpqEndpointProjector({
    project,
    resolveTempoAtBeat,
    beatAtSecondsFromAnchor,
}: SetOfflinePpqEndpointProjectorInput): void {
    offlinePpqEndpointProjectorState.project = project;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = resolveTempoAtBeat;
    offlinePpqEndpointProjectorState.beatAtSecondsFromAnchor = beatAtSecondsFromAnchor ?? null;
}
