import {
    offlineMidiEventProjectorState,
    type OfflineMidiEventProjectorFactory,
} from './offlineMidiEventProjectorState';

export function setOfflineMidiEventProjector(createProjector: OfflineMidiEventProjectorFactory): void {
    offlineMidiEventProjectorState.createProjector = createProjector;
}
