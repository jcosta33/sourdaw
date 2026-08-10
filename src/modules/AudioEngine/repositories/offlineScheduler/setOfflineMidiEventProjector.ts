import {
    offlineMidiEventProjectorState,
    type OfflineChordPitchProjectorFactory,
    type OfflineAutomationValueEvaluator,
    type OfflineMidiEventProjectorFactory,
    type OfflineMidiArticulationResolver,
    type OfflineMidiProbabilitySelector,
} from './offlineMidiEventProjectorState';

type SetOfflineMidiEventProjectorInput = {
    createProjector: OfflineMidiEventProjectorFactory;
    selectProbability: OfflineMidiProbabilitySelector;
    createChordPitchProjector: OfflineChordPitchProjectorFactory;
    evaluateAutomationValue: OfflineAutomationValueEvaluator;
    resolveArticulationId?: OfflineMidiArticulationResolver;
};

export function setOfflineMidiEventProjector({
    createProjector,
    selectProbability,
    createChordPitchProjector,
    evaluateAutomationValue,
    resolveArticulationId,
}: SetOfflineMidiEventProjectorInput): void {
    offlineMidiEventProjectorState.createProjector = createProjector;
    offlineMidiEventProjectorState.selectProbability = selectProbability;
    offlineMidiEventProjectorState.createChordPitchProjector = createChordPitchProjector;
    offlineMidiEventProjectorState.evaluateAutomationValue = evaluateAutomationValue;
    offlineMidiEventProjectorState.resolveArticulationId = resolveArticulationId ?? null;
}
