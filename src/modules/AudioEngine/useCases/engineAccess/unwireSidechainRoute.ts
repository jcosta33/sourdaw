import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const unwireSidechainRoute = inject({ audioEngine })(
    ({ audioEngine }) =>
        function unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void {
            audioEngine.unwireSidechainRoute(sourceTrackId, targetDeviceId);
        }
);
