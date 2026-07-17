import { Container } from '#/infra/di/Container';

import type { TrackAddedPayload } from '../events/TrackAddedEvent';
import type { TrackRemovedPayload } from '../events/TrackRemovedEvent';
import type { TrackSelectionChangedPayload } from '../events/TrackSelectionChangedEvent';

type ArrangementEvents = {
    'track.added': TrackAddedPayload;
    'track.removed': TrackRemovedPayload;
    'track.selectionChanged': TrackSelectionChangedPayload;
};

export abstract class ArrangementEventBus {
    abstract emit<TEventName extends keyof ArrangementEvents>(
        event: TEventName,
        payload: ArrangementEvents[TEventName]
    ): Promise<void>;
}

export function setArrangementEventBus(event_bus: ArrangementEventBus): void {
    Container.set(ArrangementEventBus, event_bus);
}
