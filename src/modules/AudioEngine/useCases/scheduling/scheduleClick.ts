import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const scheduleClick = inject({ audioEngine })(
    ({ audioEngine }) =>
        function scheduleClick(time: number, accent: boolean, volume: number = 1): void {
            audioEngine.scheduleClick(time, accent, volume);
        }
);
