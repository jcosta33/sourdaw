import type { MidiOutPayload } from '#/modules/WorkspaceShell/events';

type SetlistEvents = {
    'midi.out': MidiOutPayload;
};

export abstract class SetlistEventBus {
    abstract emit<TEventName extends keyof SetlistEvents>(
        event: TEventName,
        payload: SetlistEvents[TEventName]
    ): Promise<void>;
}
