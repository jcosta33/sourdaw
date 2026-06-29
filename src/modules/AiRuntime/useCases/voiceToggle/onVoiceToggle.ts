import { inject } from '#/infra/di/inject';

import { VoiceToggleEventBus } from './voiceToggleEventBus';

type VoiceTogglePayload = { active?: boolean };

export const onVoiceToggle = inject({ eventBus: VoiceToggleEventBus })(
    ({ eventBus }) =>
        function onVoiceToggle(handler: (payload: VoiceTogglePayload) => void): () => void {
            return eventBus.on('voice.toggle', handler);
        }
);
