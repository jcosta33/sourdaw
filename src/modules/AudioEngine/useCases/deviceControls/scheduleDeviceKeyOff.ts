import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const scheduleDeviceKeyOff = inject({ audioEngine })(
    ({ audioEngine }) =>
        function scheduleDeviceKeyOff(
            trackId: string,
            deviceId: string,
            pitch: number,
            velocity: number,
            time?: number
        ): void {
            audioEngine.scheduleDeviceKeyOff(trackId, deviceId, pitch, velocity, time);
        }
);
