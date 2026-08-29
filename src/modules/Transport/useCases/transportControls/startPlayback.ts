import { logger } from '#/infra/logger/appLogger';
import { resumeEngine, startNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getPrecedingBars } from '../../models/TimeSignatureMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { ensureTrackStrips } from '../ensureTrackStrips';
import { startPlayheadScheduler } from '../playheadScheduler/startPlayheadScheduler';
import { secondsBetweenBeats } from '../secondsBetweenBeats';
import { projectEngineTransportMaps } from '../tempoMap/projectEngineTransportMaps';

export function startPlayback(): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    // Guard against re-entry while already playing. A second spacebar (or any
    // duplicate trigger) would otherwise re-run `startPlayheadScheduler`, which
    // re-snaps `lastTickTime` to the current audio-clock time. The next worker
    // tick then sees `deltaSec ≈ 0`, advances the playhead by ~0 beats, and the
    // transport loses one grain of forward motion. No-op if already running.
    if (state.isPlaying) {
        return;
    }

    // The play gesture is the user activation that lets a suspended AudioContext
    // resume. If resume rejects, the context stays suspended (no audio), so
    // surface it instead of firing-and-forgetting; the rest of the transport
    // still advances. (Wrapped in Promise.resolve so the chain is robust to a
    // resume that returns synchronously.)
    Promise.resolve(resumeEngine()).catch((error: unknown) => {
        logger.warn(new Error('Audio engine resume failed on playback start', { cause: error }));
        notifyUser('Audio is still suspended — click anywhere to enable sound.', 'warning');
    });
    ensureTrackStrips();

    let startPosition = state.playheadPosition;
    if (state.preRollEnabled && state.preRollBars > 0) {
        // Pre-roll is a count of *bars* before the play point, so its length has
        // to come from the meter governing those bars. Multiplying the transport
        // numerator by the bar count read neither the time-signature map nor the
        // denominator, so a project with a meter change — or any meter that is
        // not x/4 — rolled in from the wrong beat.
        const preRollBars = getPrecedingBars(
            timeSignatureMapStore.value?.changes ?? [],
            startPosition,
            state.preRollBars,
            state.timeSignatureNumerator,
            state.timeSignatureDenominator
        );
        // `preRollBars > 0` is the branch condition, so there is always a bar here.
        startPosition = Math.max(0, preRollBars[0]!.startBeat);
    }

    // D3.c.4a (#3066): the native engine has no start command — the first
    // graph batch boots it — so play is where it starts, carrying this
    // session's topology. Fired rather than awaited because nothing about the
    // Web Audio transport waits on it: the native graph schedules no clips and
    // therefore renders silence, and a decline (a browser build, an addon that
    // cannot answer, a topology the native registry will not hold) leaves
    // playback exactly where it already was.
    Promise.resolve(
        startNativeLiveGraphSession({
            positionSeconds: secondsBetweenBeats(tempoMapStore.value?.changes ?? [], 0, startPosition, state.tempo),
            // Read here, at the moment of play, so the engine follows the map
            // the timeline holds now rather than the one it held when the
            // session object was made.
            transportMaps: projectEngineTransportMaps(),
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

    updateTransportState({ isPlaying: true, playheadPosition: startPosition });
    playheadPositionRef.current = startPosition;
    startPlayheadScheduler();
}
