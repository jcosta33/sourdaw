import { inject } from '#/infra/di/inject';

import { VoiceToggleEventBus } from './voiceToggleEventBus';

export const toggleVoiceInput = inject({ eventBus: VoiceToggleEventBus })(
    ({ eventBus }) =>
        function toggleVoiceInput(active?: boolean): void {
            void eventBus.emit('voice.toggle', { active });
        }
);
