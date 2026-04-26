import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'gluten'` instead. */
export const showGlutenPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showGlutenPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showGluten', { deviceId });
        }
);
