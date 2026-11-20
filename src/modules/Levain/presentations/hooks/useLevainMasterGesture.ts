import { useEffect, useRef, useState } from 'react';

import { createLevainMasterGesture } from '../../useCases/levainParamBridge/createLevainMasterGesture';

export function useLevainMasterGesture(deviceId: string, expert: boolean) {
    const controller = useRef<ReturnType<typeof createLevainMasterGesture> | null>(null);
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
        controller.current = current;
        return () => {
            current.dispose();
            mounted = false;
            controller.current = null;
        };
    }, [deviceId, expert]);

    return {
        preview: expert && preview?.deviceId === deviceId ? preview.value : undefined,
        authority: {
            acquire: () => controller.current?.start() ?? -1,
            isCurrent: (token: string | number) => controller.current?.isCurrent(token) ?? false,
        },
        change: (value: number, transient?: boolean) => controller.current?.change(value, transient),
    };
}
