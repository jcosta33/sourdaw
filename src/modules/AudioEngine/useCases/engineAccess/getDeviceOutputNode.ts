import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getDeviceOutputNode = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getDeviceOutputNode(deviceId: string): AudioNode | null {
            return audioEngine.findDeviceOutputNode(deviceId);
        }
);
