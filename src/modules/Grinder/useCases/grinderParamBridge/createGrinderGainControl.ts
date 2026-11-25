import { createDeviceParameterControl } from '#/modules/Arrangement/useCases';
import { captureDeviceParameterRuntimeWriteAuthority } from '#/modules/AudioEngine/useCases';

import { DEFAULT_PATCH } from '../../models/GrinderPatch';

import { paramBatcher } from './helpers';

export function createGrinderGainControl(deviceId: string, show: (value: number | undefined) => void) {
    return createDeviceParameterControl(
        deviceId,
        {
            deviceType: 'grinder',
            id: 'gain',
            defaultValue: DEFAULT_PATCH.gain,
            captureRuntimeAuthority: captureDeviceParameterRuntimeWriteAuthority,
            failureMessage: 'Unable to change Grinder Gain',
            cancelQueuedWrite: () => paramBatcher.cancel(`${deviceId}:gain`),
        },
        show
    );
}
