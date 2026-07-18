import { inject } from '#/infra/di/inject';
import { NotificationEventBus, type PromptPayload } from '#/utils/Notification/notificationEventBus';

export const onPrompt = inject({ eventBus: NotificationEventBus })(
    ({ eventBus }) =>
        function onPrompt(handler: (payload: PromptPayload) => void): () => void {
            return eventBus.on('ui.prompt', handler);
        }
);
