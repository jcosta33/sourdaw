import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

// ── Emitters ──────────────────────────────────────────────────────────────────

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'fermenter'` instead. */
export const showFermenterPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showFermenterPanel(deviceId: string | null): void {
            eventBus.emit('panel.showFermenter', { deviceId });
        })
);