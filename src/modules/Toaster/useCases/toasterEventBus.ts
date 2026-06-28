import { Container } from '#/infra/di/Container';

import type { TrackAddedPayload } from '#/modules/Arrangement/events';

type ToasterEvents = {
    'track.added': TrackAddedPayload;
};

export abstract class ToasterEventBus {
    abstract emit<TEventName extends keyof ToasterEvents>(
        event: TEventName,
        payload: ToasterEvents[TEventName]
    ): Promise<void>;
}

export function setToasterEventBus(event_bus: ToasterEventBus): void {
    Container.set(ToasterEventBus, event_bus);
}
