import { useLayoutEffect, useState } from 'react';

import { createDeviceParameterControl } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../../models/GrinderPatch';
import { paramBatcher } from '../../useCases/grinderParamBridge/helpers';

export function useGrinderGainControl(deviceId: string) {
    const [preview, show] = useState<number>();
    const [control] = useState(() =>
        createDeviceParameterControl(
            deviceId,
            {
                deviceType: 'grinder',
                id: 'gain',
                defaultValue: DEFAULT_PATCH.gain,
                failureMessage: 'Unable to change Grinder Gain',
                cancelQueuedWrite: () => paramBatcher.cancel(`${deviceId}:gain`),
            },
            show
        )
    );
    useLayoutEffect(() => control.connect(), [control]);
    return { preview, control };
}
