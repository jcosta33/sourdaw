import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'builtin-crumbs'` instead. */
export const showCrumbsPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showCrumbsPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showCrumbs', { deviceId });
        }
);
