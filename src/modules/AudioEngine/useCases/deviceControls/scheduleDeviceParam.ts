import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const scheduleDeviceParam = inject({ audioEngine })(
    ({ audioEngine }) =>
        function scheduleDeviceParam(
            trackId: string,
            deviceId: string,
            paramId: string,
            value: number,
            time: number
        ): void {
            audioEngine.scheduleDeviceParam(trackId, deviceId, paramId, value, time);
        }
);
