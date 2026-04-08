import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ToggleVoiceCommandPayload } from '#/modules/Workspace/events/WorkspaceEvents';

export const toggleVoiceInput = inject({ eventBus })(
    ({ eventBus }) =>
        function toggleVoiceInput(active?: boolean): void {
            eventBus.emit('voice.toggle', { active });
        }
);

export const onVoiceToggle = inject({ eventBus })(
    ({ eventBus }) =>
        function onVoiceToggle(handler: (payload: ToggleVoiceCommandPayload) => void): () => void {
            return eventBus.on('voice.toggle', handler);
        }
);
