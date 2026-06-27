import { Container } from '#/infra/di/Container';

import type {
    TrackAddedPayload,
    TrackRemovedPayload,
    TrackSelectionChangedPayload,
} from '../events';

type ArrangementEvents = {
    'track.added': TrackAddedPayload;
    'track.removed': TrackRemovedPayload;
    'track.selectionChanged': TrackSelectionChangedPayload;
};

export abstract class ArrangementEventBus {
    abstract emit<TEventName extends keyof ArrangementEvents & string>(
        event: TEventName,
        payload: ArrangementEvents[TEventName]
    ): Promise<void>;
}

export function setArrangementEventBus(event_bus: ArrangementEventBus): void {
    Container.set(ArrangementEventBus, event_bus);
}
