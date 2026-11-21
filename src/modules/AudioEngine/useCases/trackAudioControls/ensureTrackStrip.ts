import { inject } from '#/infra/di/inject';

import { type TrackChannelStrip } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

export const ensureTrackStrip = inject({ audioEngine })(
    ({ audioEngine }) =>
        function ensureTrackStrip(trackId: string): TrackChannelStrip {
            return audioEngine.ensureTrackStrip(trackId);
        }
);
