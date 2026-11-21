import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getAudioSampleRate = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getAudioSampleRate(): number {
            return audioEngine.context?.sampleRate ?? 44100;
        }
);
