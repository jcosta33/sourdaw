import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const removeMidiFxFromStrip = inject({ audioEngine })(
    ({ audioEngine }) =>
        function removeMidiFxFromStrip(trackId: string, fxId: string): void {
            audioEngine.removeMidiFxFromStrip(trackId, fxId);
        }
);
