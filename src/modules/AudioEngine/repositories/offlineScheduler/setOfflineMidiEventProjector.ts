import {
    offlineMidiEventProjectorState,
    type OfflineChordPitchProjectorFactory,
    type OfflineMidiEventProjectorFactory,
    type OfflineMidiProbabilitySelector,
} from './offlineMidiEventProjectorState';

type SetOfflineMidiEventProjectorInput = {
    createProjector: OfflineMidiEventProjectorFactory;
    selectProbability: OfflineMidiProbabilitySelector;
    createChordPitchProjector: OfflineChordPitchProjectorFactory;
};

export function setOfflineMidiEventProjector({
    createProjector,
    selectProbability,
    createChordPitchProjector,
}: SetOfflineMidiEventProjectorInput): void {
    offlineMidiEventProjectorState.createProjector = createProjector;
    offlineMidiEventProjectorState.selectProbability = selectProbability;
    offlineMidiEventProjectorState.createChordPitchProjector = createChordPitchProjector;
}
