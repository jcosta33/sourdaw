import { setOfflineMidiEventProjector } from '../repositories/offlineScheduler/setOfflineMidiEventProjector';

type ConfigureOfflineMidiEventProjectionInput = {
    createProjector: Parameters<typeof setOfflineMidiEventProjector>[0];
};

export function configureOfflineMidiEventProjection({
    createProjector,
}: ConfigureOfflineMidiEventProjectionInput): void {
    setOfflineMidiEventProjector(createProjector);
}
