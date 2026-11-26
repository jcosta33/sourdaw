import { inject } from '#/infra/di/inject';

import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Tears down a bus's channel strip in the audio engine, disposing its BusNode
 * and sweeping any sends that fed into it.
 *
 * Must be called when a bus track is deleted from project truth — otherwise the
 * BusNode keeps summing and processing in the live graph (a leaked node).
 */
export const removeBusStrip = inject({ audioEngine })(
    ({ audioEngine }) =>
        function removeBusStrip(busId: string): void {
            audioEngine.removeBusStrip(busId);
        }
);
