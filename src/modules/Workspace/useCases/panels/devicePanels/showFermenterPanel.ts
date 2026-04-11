import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

// ── Emitters ──────────────────────────────────────────────────────────────────

export const showFermenterPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showFermenterPanel(deviceId: string | null): void {
            eventBus.emit('panel.showFermenter', { deviceId });
        })
);