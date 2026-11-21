import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getMasterAnalyser = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getMasterAnalyser(): AnalyserNode {
            return audioEngine.masterAnalyser;
        }
);
