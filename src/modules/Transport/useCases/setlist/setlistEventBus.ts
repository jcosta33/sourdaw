import { Container } from '#/infra/di/Container';

import type { MidiOutPayload } from '#/modules/Workspace/events';

type SetlistEvents = {
    'midi.out': MidiOutPayload;
};

export abstract class SetlistEventBus {
    abstract emit<TEventName extends keyof SetlistEvents & string>(
        event: TEventName,
        payload: SetlistEvents[TEventName]
    ): Promise<void>;
}

export function setSetlistEventBus(event_bus: SetlistEventBus): void {
    Container.set(SetlistEventBus, event_bus);
}
