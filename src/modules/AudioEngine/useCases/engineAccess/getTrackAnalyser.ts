import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getTrackAnalyser = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getTrackAnalyser(trackId: string): AnalyserNode | null {
            return audioEngine.getTrackStrip(trackId)?.analyserNode ?? null;
        }
);
