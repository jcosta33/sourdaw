import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Name the tracks the native live session currently sounds, which is the only
 * caller this exists for: Web Audio keeps rendering them but stops letting them
 * out, so the two engines never sound the same track at once.
 */
export const setNativeCarriedTracks = inject({ audioEngine })(
    ({ audioEngine }) =>
        function setNativeCarriedTracks(trackIds: ReadonlySet<string>): void {
            audioEngine.setNativeCarriedTracks(trackIds);
        }
);
