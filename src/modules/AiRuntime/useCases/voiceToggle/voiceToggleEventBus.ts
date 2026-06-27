import { Container } from '#/infra/di/Container';

import type { ToggleVoiceCommandPayload } from '#/modules/Workspace/events';

type VoiceToggleEvents = {
    'voice.toggle': ToggleVoiceCommandPayload;
};

export abstract class VoiceToggleEventBus {
    abstract emit<TEventName extends keyof VoiceToggleEvents & string>(
        event: TEventName,
        payload: VoiceToggleEvents[TEventName]
    ): Promise<void>;
    abstract on<TEventName extends keyof VoiceToggleEvents & string>(
        event: TEventName,
        handler: (payload: VoiceToggleEvents[TEventName]) => void | Promise<void>
    ): () => void;
}

export function setVoiceToggleEventBus(event_bus: VoiceToggleEventBus): void {
    Container.set(VoiceToggleEventBus, event_bus);
}
