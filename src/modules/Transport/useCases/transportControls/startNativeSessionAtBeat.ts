/**
 * Fire the native live graph session for one play, from one beat.
 *
 * Held apart from `startPlayback` because a play is not the only thing that
 * starts a session: `rearmNativeSessionAfterEngineRetire` starts one mid-play,
 * from the live playhead, after a lost engine was retired (#3960). Both need
 * the same position projection, the same freshly read transport maps, and the
 * same fire-and-forget handling of a decline.
 */

import { logger } from '#/infra/logger/appLogger';
import { getAudioContext, startNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';

import { tempoMapStore } from '../../stores/tempoMapStore';
import { secondsBetweenBeats } from '../secondsBetweenBeats';
import { projectEngineTransportMaps } from '../tempoMap/projectEngineTransportMaps';

export function startNativeSessionAtBeat(startBeat: number, tempo: number): void {
    // D3.c.4a (#3066): the native engine has no start command — the first
    // graph batch boots it — so play is where it starts, carrying this
    // session's topology and, since #3068, its programme. Fired rather than
    // awaited because nothing about the Web Audio transport waits on it: the
    // session sounds only the strips the carrier law hands it and gates those
    // out of Web Audio itself (#3564), so Web Audio starts every strip here and
    // gives the carried ones up when the session says so. A decline (a browser
    // build, an addon that cannot answer, a topology the native registry will
    // not hold) leaves playback exactly where it already was.
    Promise.resolve(
        startNativeLiveGraphSession({
            positionSeconds: secondsBetweenBeats(tempoMapStore.value?.changes ?? [], 0, startBeat, tempo),
            // Read here, at the moment of play, so the engine follows the map
            // the timeline holds now rather than the one it held when the
            // session object was made.
            transportMaps: projectEngineTransportMaps(),
            // The grid the live scheduler already places this arrangement on,
            // so the native programme lands on the same samples the Web Audio
            // path does rather than on a second rounding of the same beats.
            sampleRate: getAudioContext().sampleRate,
        })
    )
        .then((result) => {
            if (result.outcome === 'declined') {
                logger.debug(`Native live graph session declined: ${result.reason}`);
            }
        })
        .catch((error: unknown) => {
            logger.warn(new Error('Native live graph session failed to start', { cause: error }));
        });
}
