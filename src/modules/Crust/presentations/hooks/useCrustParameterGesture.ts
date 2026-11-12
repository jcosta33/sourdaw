import { useEffect, useRef } from 'react';

import { type CrustPatch } from '../../models/CrustPatch';
import { createCrustParameterGesture } from '../../useCases/createCrustParameterGesture';

export function useCrustParameterGesture(deviceId: string) {
    const controller = useRef<ReturnType<typeof createCrustParameterGesture> | null>(null);
    useEffect(() => {
        const current = createCrustParameterGesture(deviceId);
        controller.current = current;
        return () => {
            current.dispose();
            if (controller.current === current) {
                controller.current = null;
            }
        };
    }, [deviceId]);
    return {
        start: (key: keyof CrustPatch) => controller.current?.start(key) ?? -1,
        authority: (key: keyof CrustPatch) => ({
            acquire: () => controller.current?.start(key) ?? -1,
            isCurrent: (token: string | number) => controller.current?.isCurrent(key, token) ?? false,
        }),
        change: (key: keyof CrustPatch, value: number, transient = false, recordingSample = true) =>
            controller.current?.change(key, value, transient, recordingSample),
        settle: (key: keyof CrustPatch) => controller.current?.settle(key),
        cancel: (key: keyof CrustPatch) => controller.current?.cancel(key),
    };
}
