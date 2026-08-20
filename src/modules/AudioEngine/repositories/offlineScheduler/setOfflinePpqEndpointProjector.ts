import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from './offlinePpqEndpointProjectorState';

type SetOfflinePpqEndpointProjectorInput = {
    project: OfflinePpqEndpointProjector;
    /**
     * Optional so a test that only needs timeline placement configures only
     * that. Absent, the clip projection falls back to the project's default
     * tempo — the answer the tempo law itself gives for an empty map.
     */
    resolveTempoAtBeat?: OfflineTempoAtBeatResolver;
};

export function setOfflinePpqEndpointProjector({
    project,
    resolveTempoAtBeat,
}: SetOfflinePpqEndpointProjectorInput): void {
    offlinePpqEndpointProjectorState.project = project;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = resolveTempoAtBeat ?? null;
}
