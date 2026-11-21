import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const updateMidiFxBypass = inject({ audioEngine })(
    ({ audioEngine }) =>
        function updateMidiFxBypass(trackId: string, fxId: string, bypassed: boolean): void {
            audioEngine.updateMidiFxBypass(trackId, fxId, bypassed);
        }
);
