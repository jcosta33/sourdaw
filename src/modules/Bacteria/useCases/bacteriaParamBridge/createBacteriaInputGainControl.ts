import { createDeviceParameterControl } from '#/modules/Arrangement/useCases';
import { captureDeviceParameterRuntimeWriteAuthority } from '#/modules/AudioEngine/useCases';

import { DEFAULT_PATCH } from '../../models/BacteriaPatch';

import { paramBatcher } from './helpers';

export function createBacteriaInputGainControl(deviceId: string, show: (value: number | undefined) => void) {
    return createDeviceParameterControl(
        deviceId,
        {
            deviceType: 'bacteria',
            id: 'inputGain',
            defaultValue: DEFAULT_PATCH.inputGain,
            captureRuntimeAuthority: captureDeviceParameterRuntimeWriteAuthority,
            failureMessage: 'Unable to change Bacteria Input gain',
            cancelQueuedWrite: () => paramBatcher.cancel(`${deviceId}:inputGain`),
        },
        show
    );
}
