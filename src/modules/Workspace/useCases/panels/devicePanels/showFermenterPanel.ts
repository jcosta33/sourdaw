import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

// ── Emitters ──────────────────────────────────────────────────────────────────

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'fermenter'` instead. */
export const showFermenterPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showFermenterPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showFermenter', { deviceId });
        }
);
