import { useSyncExternalStore } from 'react';

import { subscribeToGrandBouleRuntime } from '../../stores/grandBouleRuntimeNotifications';
import { readGrandBouleRuntimeControls } from '../../useCases/readGrandBouleRuntimeControls';

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
        const unsubscribe = subscribeToGrandBouleRuntime(deviceId, onChange);
        retirement = read()?.retirement;
        retirement?.addEventListener('abort', onChange);
        return () => {
            unsubscribe();
            retirement?.removeEventListener('abort', onChange);
        };
    }, read);
    return controls;
}
