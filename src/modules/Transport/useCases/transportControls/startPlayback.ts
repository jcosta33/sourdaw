import { logger } from '#/infra/logger/appLogger';
import { nativeLiveGraphSessionOffered, resumeEngine } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { holdPlayheadClock, releasePlayheadClockHold } from '../../stores/playheadClockRef';
import { playheadWrapCountRef } from '../../stores/playheadWrapCountRef';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { ensureTrackStrips } from '../ensureTrackStrips';
import { claimSchedulerSession } from '../playheadScheduler/claimSchedulerSession';
import { startPlayheadScheduler } from '../playheadScheduler/startPlayheadScheduler';
import { prepareInitialBrowserPlayback } from '../playheadScheduler/prepareInitialBrowserPlayback';
import { schedulerSession } from '../playheadScheduler/schedulerSession';

import { resolveRollStartBeat } from './resolveRollStartBeat';
import { startNativeSessionAtBeat } from './startNativeSessionAtBeat';
import { startSchedulerWhenNativeSessionSettles, type HoldRelease } from './startSchedulerWhenNativeSessionSettles';
import { stopPlayback } from './stopPlayback';

/**
 * Resolves once the scheduler start has been decided, so a caller that has to
 * know when the transport actually rolled — a take opened from a stopped
 * transport, whose buffer is placed against that instant — can wait for it. A
 * browser build prepares its first window before admitting the roll; a desktop
 * build decides when the native session settles or the hold cap expires.
 */
export async function startPlayback(onRoll?: (contextSeconds: number, beat: number) => void): Promise<void> {
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

    const startPosition = resolveRollStartBeat(state, timeSignatureMapStore.value?.changes ?? []);
    const browserGeneration = nativeLiveGraphSessionOffered() ? null : claimSchedulerSession();
    const browserRoot = browserGeneration === null ? null : captureProjectRootIdentity();
    if (browserGeneration !== null) {
        holdPlayheadClock(browserGeneration, startPosition);
    }

    updateTransportState({ isPlaying: true, playheadPosition: startPosition });
    playheadPositionRef.current = startPosition;
    // The store position above is the new roll's epoch, and the wrap count
    // must describe the same roll from this instant: the scheduler that
    // resets it starts only after the native-session hold (up to its 250 ms
    // cap), and a capture in the hold would otherwise bound old events by the
    // dead roll's wraps instead of the fresh epoch.
    playheadWrapCountRef.current = 0;

    if (browserGeneration !== null) {
        const generation = browserGeneration;
        const stillOwnsRequest = () =>
            schedulerSession.generation === generation &&
            captureProjectRootIdentity() === browserRoot &&
            getTransportState()?.isPlaying === true;
        const refuseCurrentRequest = async () => {
            if (stillOwnsRequest()) {
                await stopPlayback();
                notifyUser('Playback changed while preparing. Press Play again.', 'warning');
            }
        };
        try {
            if (!stillOwnsRequest()) {
                return;
            }
            const prepared = prepareInitialBrowserPlayback(generation);
            if (!prepared) {
                await refuseCurrentRequest();
                return;
            }
            // The scheduler settles recording and programme readiness before
            // admitting its one future roll anchor.
            const started = await startPlayheadScheduler(prepared, onRoll);
            if (started !== true) {
                await refuseCurrentRequest();
            }
        } catch (error) {
            logger.error(new Error('Playback preparation failed', { cause: error }));
            await refuseCurrentRequest();
        } finally {
            releasePlayheadClockHold(generation);
        }
        return;
    }

    // Claimed before the session is asked for, so the hold names the generation
    // this play opened rather than one a stop inside the hold has since
    // replaced, and so any session still ticking — one a pause left running
    // because its teardown is deferred behind a recording flush — is retired
    // now instead of advancing the playhead through the wait.
    releasePlayheadClockHold(schedulerSession.generation);
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
    await startSchedulerWhenNativeSessionSettles(session, generation, release, onRoll);
}
