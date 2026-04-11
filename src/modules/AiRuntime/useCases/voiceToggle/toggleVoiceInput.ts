import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const toggleVoiceInput = inject({ eventBus })(
    ({ eventBus }) =>
        (function toggleVoiceInput(active?: boolean): void {
            eventBus.emit('voice.toggle', { active });
        })
);