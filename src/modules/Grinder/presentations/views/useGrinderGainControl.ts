import { useLayoutEffect, useState } from 'react';

import { createGrinderGainControl } from '../../useCases/grinderParamBridge/createGrinderGainControl';

export function useGrinderGainControl(deviceId: string) {
    const [preview, setPreview] = useState<number>();
    const [control] = useState(() => createGrinderGainControl(deviceId, setPreview));
    useLayoutEffect(() => control.connect(), [control]);
    return { preview, control };
}
