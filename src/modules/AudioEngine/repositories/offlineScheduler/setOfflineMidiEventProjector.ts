import {
    offlineMidiEventProjectorState,
    type OfflineChordPitchProjector,
    type OfflineMidiEventProjectorFactory,
    type OfflineMidiProbabilitySelector,
} from './offlineMidiEventProjectorState';

type SetOfflineMidiEventProjectorInput = {
    createProjector: OfflineMidiEventProjectorFactory;
    selectProbability: OfflineMidiProbabilitySelector;
    projectChordPitch: OfflineChordPitchProjector;
};

export function setOfflineMidiEventProjector({
    createProjector,
    selectProbability,
    projectChordPitch,
}: SetOfflineMidiEventProjectorInput): void {
    offlineMidiEventProjectorState.createProjector = createProjector;
    offlineMidiEventProjectorState.selectProbability = selectProbability;
    offlineMidiEventProjectorState.projectChordPitch = projectChordPitch;
}
