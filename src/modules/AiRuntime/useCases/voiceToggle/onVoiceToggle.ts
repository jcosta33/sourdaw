import { eventBus } from '#/app/registerDependencies';

type VoiceTogglePayload = { active?: boolean };

export function onVoiceToggle(handler: (payload: VoiceTogglePayload) => void): () => void {
    return eventBus.on('voice.toggle', handler);
}
