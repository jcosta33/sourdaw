import {
    offlineMidiEventProjectorState,
    type OfflineChordPitchProjectorFactory,
    type OfflineAutomationValueEvaluator,
    type OfflineClipControllerProjector,
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
    projectClipControllers?: OfflineClipControllerProjector;
};

export function setOfflineMidiEventProjector({
    createProjector,
    selectProbability,
    createChordPitchProjector,
    evaluateAutomationValue,
    resolveArticulationId,
    projectClipControllers,
}: SetOfflineMidiEventProjectorInput): void {
    offlineMidiEventProjectorState.createProjector = createProjector;
    offlineMidiEventProjectorState.selectProbability = selectProbability;
    offlineMidiEventProjectorState.createChordPitchProjector = createChordPitchProjector;
    offlineMidiEventProjectorState.evaluateAutomationValue = evaluateAutomationValue;
    offlineMidiEventProjectorState.resolveArticulationId = resolveArticulationId ?? null;
    offlineMidiEventProjectorState.projectClipControllers = projectClipControllers ?? null;
}
