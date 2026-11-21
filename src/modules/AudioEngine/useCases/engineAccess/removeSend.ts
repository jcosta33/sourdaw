import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const removeSend = inject({ audioEngine })(
    ({ audioEngine }) =>
        function removeSend(sourceTrackId: string, busId: string): void {
            audioEngine.removeSend(sourceTrackId, busId);
        }
);
