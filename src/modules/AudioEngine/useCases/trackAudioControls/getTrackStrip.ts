import { inject } from '#/infra/di/inject';

import { type TrackChannelStrip } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

export const getTrackStrip = inject({ audioEngine })(
    ({ audioEngine }) =>
        function getTrackStrip(trackId: string): TrackChannelStrip | undefined {
            return audioEngine.getTrackStrip(trackId);
        }
);
