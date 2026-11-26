import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

export const addMidiFxToStrip = inject({ audioEngine })(
    ({ audioEngine }) =>
        function addMidiFxToStrip(trackId: string, fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void {
            audioEngine.addMidiFxToStrip(trackId, fxId, fxType);
        }
);
