import { Container } from '#/infra/di/Container';

import type { ToggleVoiceCommandPayload, VoidPayload } from '#/modules/Workspace/events';

type CommandEvents = {
    'zoom.scrollToPlayhead': VoidPayload;
    'voice.toggle': ToggleVoiceCommandPayload;
};

export abstract class CommandEventBus {
    abstract emit<TEventName extends keyof CommandEvents>(
        event: TEventName,
        payload: CommandEvents[TEventName]
    ): Promise<void>;
}

export function setCommandEventBus(event_bus: CommandEventBus): void {
    Container.set(CommandEventBus, event_bus);
}
