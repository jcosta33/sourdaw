import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const scheduleDeviceKeyOn = inject({ audioEngine })(
    ({ audioEngine }) =>
        function scheduleDeviceKeyOn(
            trackId: string,
            deviceId: string,
            pitch: number,
            velocity: number,
            time?: number
        ): void {
            audioEngine.scheduleDeviceKeyOn(trackId, deviceId, pitch, velocity, time);
        }
);
