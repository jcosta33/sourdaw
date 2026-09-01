import { flushDeferredStorageNotice } from '#/infra/store/storage/storageFullNotice';
import { setVoiceToggleEventBus } from '#/modules/AiRuntime/useCases';
import { setCommandEventBus } from '#/modules/Command/useCases';
import { setWebMidiRuntimeEventBus } from '#/modules/MIDI/useCases';
import { setWorkspaceEventBus } from '#/modules/WorkspaceShell/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { eventBus } from './registerDependencies';

export function registerNotificationEventBus(): void {
    setWorkspaceEventBus(eventBus);
    setVoiceToggleEventBus(eventBus);
    setNotificationEventBus(eventBus);
    setWebMidiRuntimeEventBus({ eventBus });
    setCommandEventBus(eventBus);
    flushDeferredStorageNotice();
}
