import { setOfflineMidiEventProjector } from '../repositories/offlineScheduler/setOfflineMidiEventProjector';

type ConfigureOfflineMidiEventProjectionInput = Parameters<typeof setOfflineMidiEventProjector>[0];

export function configureOfflineMidiEventProjection({
    createProjector,
    selectProbability,
    projectChordPitch,
}: ConfigureOfflineMidiEventProjectionInput): void {
    setOfflineMidiEventProjector({ createProjector, selectProbability, projectChordPitch });
}
