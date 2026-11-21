import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const updateMidiFxParam = inject({ audioEngine })(
    ({ audioEngine }) =>
        function updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void {
            audioEngine.updateMidiFxParam(trackId, fxId, paramId, value);
        }
);
