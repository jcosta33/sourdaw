import { useSyncExternalStore } from 'react';

import { inject } from '#/infra/di/inject';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { GrandBouleEventBus } from '../../useCases/grandBouleEventBus';
import { readGrandBouleRuntimeControls } from '../../useCases/readGrandBouleRuntimeControls';

const subscribeToLifecycle = inject({ eventBus: GrandBouleEventBus })(
    ({ eventBus }) =>
        (deviceId: string, notify: () => void): (() => void) => {
            const onChange = (event: { deviceId: string; deviceType: string }): void => {
                if (event.deviceId === deviceId && event.deviceType === DEVICE_TYPE_IDS.grandBoule) {
                    notify();
                }
            };
            const loaded = eventBus.on('audioDevice.loaded', onChange);
            const removed = eventBus.on('audioDevice.removed', onChange);
            return () => {
                loaded();
                removed();
            };
        }
);

export function useGrandBouleRuntime(trackId: string | undefined, deviceId: string) {
    const read = () => readGrandBouleRuntimeControls(trackId, deviceId);
    const controls = useSyncExternalStore((notify) => {
        let retirement: AbortSignal | undefined;
        const onChange = (): void => {
            retirement?.removeEventListener('abort', onChange);
            retirement = read()?.retirement;
            retirement?.addEventListener('abort', onChange);
            notify();
        };
        const unsubscribe = subscribeToLifecycle(deviceId, onChange);
        retirement = read()?.retirement;
        retirement?.addEventListener('abort', onChange);
        return () => {
            unsubscribe();
            retirement?.removeEventListener('abort', onChange);
        };
    }, read);
    return controls;
}
