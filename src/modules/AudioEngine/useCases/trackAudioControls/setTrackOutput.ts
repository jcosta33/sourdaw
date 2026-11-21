import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const setTrackOutput = inject({ audioEngine })(
    ({ audioEngine }) =>
        function setTrackOutput(
            trackId: string,
            outputId: string,
            padBinding?: { toasterParentTrackId: string; padIndex: number }
        ): void {
            audioEngine.setTrackOutput(trackId, outputId, padBinding);
        }
);
