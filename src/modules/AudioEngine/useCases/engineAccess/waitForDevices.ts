import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const waitForDevices = inject({ audioEngine })(
    ({ audioEngine }) =>
        function waitForDevices(): ReturnType<typeof audioEngine.waitForDevices> {
            return audioEngine.waitForDevices();
        }
);
