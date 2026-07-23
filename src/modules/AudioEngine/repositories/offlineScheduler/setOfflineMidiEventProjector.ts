import {
    offlineMidiEventProjectorState,
    type OfflineChordPitchProjectorFactory,
    type OfflineAutomationValueEvaluator,
    type OfflineMidiEventProjectorFactory,
    type OfflineMidiProbabilitySelector,
} from './offlineMidiEventProjectorState';

type SetOfflineMidiEventProjectorInput = {
    createProjector: OfflineMidiEventProjectorFactory;
    selectProbability: OfflineMidiProbabilitySelector;
    createChordPitchProjector: OfflineChordPitchProjectorFactory;
    evaluateAutomationValue: OfflineAutomationValueEvaluator;
};

export function setOfflineMidiEventProjector({
    createProjector,
    selectProbability,
    createChordPitchProjector,
    evaluateAutomationValue,
}: SetOfflineMidiEventProjectorInput): void {
    offlineMidiEventProjectorState.createProjector = createProjector;
    offlineMidiEventProjectorState.selectProbability = selectProbability;
    offlineMidiEventProjectorState.createChordPitchProjector = createChordPitchProjector;
    offlineMidiEventProjectorState.evaluateAutomationValue = evaluateAutomationValue;
}
