import { setOfflineMidiEventProjector } from '../repositories/offlineScheduler/setOfflineMidiEventProjector';

type ConfigureOfflineMidiEventProjectionInput = Parameters<typeof setOfflineMidiEventProjector>[0];

export function configureOfflineMidiEventProjection({
    createProjector,
    selectProbability,
    createChordPitchProjector,
    evaluateAutomationValue,
    resolveArticulationId,
}: ConfigureOfflineMidiEventProjectionInput): void {
    setOfflineMidiEventProjector({
        createProjector,
        selectProbability,
        createChordPitchProjector,
        evaluateAutomationValue,
        resolveArticulationId,
    });
}
