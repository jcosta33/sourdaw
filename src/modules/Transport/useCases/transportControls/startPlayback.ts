import { logger } from '#/infra/logger/appLogger';
import { nativeLiveGraphSessionOffered, resumeEngine } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getPrecedingBars } from '../../models/TimeSignatureMap';
import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { ensureTrackStrips } from '../ensureTrackStrips';
import { claimSchedulerSession } from '../playheadScheduler/claimSchedulerSession';
import { startPlayheadScheduler } from '../playheadScheduler/startPlayheadScheduler';

import { startNativeSessionAtBeat } from './startNativeSessionAtBeat';
import { startSchedulerWhenNativeSessionSettles, type HoldRelease } from './startSchedulerWhenNativeSessionSettles';

/**
 * Resolves once the scheduler start has been decided, so a caller that has to
 * know when the transport actually rolled — a take opened from a stopped
 * transport, whose buffer is placed against that instant — can wait for it. A
 * browser build decides synchronously; a desktop build decides when the native
 * session settles or the hold cap expires.
 */
export async function startPlayback(): Promise<void> {
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

    updateTransportState({ isPlaying: true, playheadPosition: startPosition });
    playheadPositionRef.current = startPosition;

    if (!nativeLiveGraphSessionOffered()) {
        startPlayheadScheduler();
        return;
    }

    // Claimed before the session is asked for, so the hold names the generation
    // this play opened rather than one a stop inside the hold has since
    // replaced, and so any session still ticking — one a pause left running
    // because its teardown is deferred behind a recording flush — is retired
    // now instead of advancing the playhead through the wait.
    const generation = claimSchedulerSession();
    // Held: the scheduler below waits for this session, so nothing has sounded
    // between the gesture and the roll and the engine opens where play asked.
    // The holder is what the hold writes if it gives up on a session slower
    // than its cap; the session reads it as it rolls, and projects from there
    // rather than opening behind a transport that is already sounding.
    const release: HoldRelease = { contextSeconds: null };
    const session = startNativeSessionAtBeat(startPosition, state.tempo, {
        kind: 'held',
        webAudioRollingSince: () => release.contextSeconds,
    });
    await startSchedulerWhenNativeSessionSettles(session, generation, release);
}
