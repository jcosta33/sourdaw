import { Container } from '#/infra/di/Container';

import type { YeastNotesOffPayload } from '../events';

type YeastEvents = {
    'yeast.notesOff': YeastNotesOffPayload;
};

export abstract class YeastEventBus {
    abstract emit<TEventName extends keyof YeastEvents & string>(
        event: TEventName,
        payload: YeastEvents[TEventName]
    ): Promise<void>;
}

export function setYeastEventBus(event_bus: YeastEventBus): void {
    Container.set(YeastEventBus, event_bus);
}
