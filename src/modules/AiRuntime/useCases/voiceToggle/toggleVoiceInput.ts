import { inject } from '#/infra/di/inject';

import { voiceCommandGesture } from '../voiceInput/voiceCommandGesture';

import { VoiceToggleEventBus } from './voiceToggleEventBus';

export const toggleVoiceInput = inject({ eventBus: VoiceToggleEventBus })(
    ({ eventBus }) =>
        function toggleVoiceInput(event: Event): void {
            const gesture = voiceCommandGesture.issue(event);
            if (gesture) {
                void eventBus.emit('voice.toggle', { gesture });
            }
        }
);
