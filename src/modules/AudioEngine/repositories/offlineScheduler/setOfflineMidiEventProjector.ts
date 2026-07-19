import { offlineMidiEventProjectorState, type OfflineMidiEventProjector } from './offlineMidiEventProjectorState';

export function setOfflineMidiEventProjector(project: OfflineMidiEventProjector): void {
    offlineMidiEventProjectorState.project = project;
}
