import { setOfflineMidiEventProjector } from '../repositories/offlineScheduler/setOfflineMidiEventProjector';

type ConfigureOfflineMidiEventProjectionInput = {
    project: Parameters<typeof setOfflineMidiEventProjector>[0];
};

export function configureOfflineMidiEventProjection({ project }: ConfigureOfflineMidiEventProjectionInput): void {
    setOfflineMidiEventProjector(project);
}
