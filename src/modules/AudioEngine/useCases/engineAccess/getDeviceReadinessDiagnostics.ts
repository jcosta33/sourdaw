import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getDeviceReadinessDiagnostics = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getDeviceReadinessDiagnostics() {
            return audioEngine.getDeviceReadinessDiagnostics();
        }
);
