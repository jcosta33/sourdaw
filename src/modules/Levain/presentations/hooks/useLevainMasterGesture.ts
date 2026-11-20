import { useEffect, useRef, useState } from 'react';

import { createLevainMasterGesture } from '../../useCases/levainParamBridge/createLevainMasterGesture';

export function useLevainMasterGesture(deviceId: string, expert: boolean, committedValue: number) {
    const controllerRef = useRef<ReturnType<typeof createLevainMasterGesture> | null>(null);
    const [preview, setPreview] = useState<{ deviceId: string; value: number } | null>(null);
    useEffect(() => {
        if (!expert) {
            return undefined;
        }
        let mounted = true;
        const current = createLevainMasterGesture(deviceId, (value) => {
            if (mounted) {
                setPreview(value === undefined ? null : { deviceId, value });
            }
        });
        controllerRef.current = current;
        return () => {
            current.dispose();
            mounted = false;
            controllerRef.current = null;
        };
    }, [deviceId, expert]);

    return {
        displayedValue: expert && preview?.deviceId === deviceId ? preview.value : committedValue,
        authority: {
            acquire: () => controllerRef.current?.start() ?? -1,
            isCurrent: (token: string | number) => controllerRef.current?.isCurrent(token) ?? false,
        },
        change: (value: number, transient?: boolean) => controllerRef.current?.change(value, transient),
    };
}
