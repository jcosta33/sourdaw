import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const setSend = inject({ audioEngine })(
    ({ audioEngine }) =>
        function setSend(sourceTrackId: string, busId: string, level: number, preFader: boolean): void {
            audioEngine.setSend(sourceTrackId, busId, level, preFader);
        }
);
