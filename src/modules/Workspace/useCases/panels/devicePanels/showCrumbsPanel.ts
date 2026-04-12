import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'builtin-crumbs'` instead. */
export const showCrumbsPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showCrumbsPanel(deviceId: string | null): void {
            eventBus.emit('panel.showCrumbs', { deviceId });
        })
);