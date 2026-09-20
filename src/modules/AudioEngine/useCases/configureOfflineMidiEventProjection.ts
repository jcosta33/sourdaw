import { setOfflineMidiEventProjector } from '../repositories/offlineScheduler/setOfflineMidiEventProjector';

import { offlineRenderCapturePorts } from './offlineRender/offlineRenderCapturePorts';

type ConfigureOfflineMidiEventProjectionInput = Omit<
    Parameters<typeof setOfflineMidiEventProjector>[0],
    'createProjector' | 'createChordPitchProjector'
> & {
    createProjector: NonNullable<typeof offlineRenderCapturePorts.createMidiProjector>;
    createChordPitchProjector: NonNullable<typeof offlineRenderCapturePorts.createChordProjector>;
    createAutomationValueEvaluator?: NonNullable<typeof offlineRenderCapturePorts.createAutomationEvaluator>;
};

export function configureOfflineMidiEventProjection({
    createAutomationValueEvaluator,
    createProjector,
    selectProbability,
    createChordPitchProjector,
    evaluateAutomationValue,
    resolveArticulationId,
}: ConfigureOfflineMidiEventProjectionInput): void {
    offlineRenderCapturePorts.createMidiProjector = createProjector;
    offlineRenderCapturePorts.createChordProjector = createChordPitchProjector;
    offlineRenderCapturePorts.createAutomationEvaluator = createAutomationValueEvaluator ?? null;
    setOfflineMidiEventProjector({
        createProjector,
        selectProbability,
        createChordPitchProjector,
        evaluateAutomationValue,
        resolveArticulationId,
    });
}
