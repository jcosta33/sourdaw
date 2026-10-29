import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    nativeLiveGraphSessionOffered,
    resumeEngine,
    startNativeLiveGraphSession,
} from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadClockRef } from '../../../stores/playheadClockRef';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { ensureTrackStrips } from '../../ensureTrackStrips';
// Real by default: `generation` is the identity the hold compares, so bumping
// the live holder is the only way to test the relation it actually reads. The
// `vi.fn` wrapper exists so one case can stand the claim's own wrap-count zero
// down and isolate the epoch write's; `mockReset` hands the real one back.
import { claimSchedulerSession } from '../../playheadScheduler/claimSchedulerSession';
import { prepareInitialBrowserPlayback } from '../../playheadScheduler/prepareInitialBrowserPlayback';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { startPlayheadScheduler } from '../../playheadScheduler/startPlayheadScheduler';
import { startPlayback } from '../startPlayback';
import { stopPlayback } from '../stopPlayback';

const { timeSignatureMapStore } = vi.hoisted(
    (): { timeSignatureMapStore: { value: { changes: unknown[] } | null } } => ({
        timeSignatureMapStore: { value: { changes: [] } },
    })
);
/**
 * What the audio context's clock reads. The hold writes this reading into the
 * held transport when it gives up on a slow session, so a case about the cap
 * has to be able to tell that reading apart from zero.
 */
const { audioClock } = vi.hoisted((): { audioClock: { currentTime: number } } => ({
    audioClock: { currentTime: 0 },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({ timeSignatureMapStore }));
vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({ captureProjectRootIdentity: () => 'playback-fixture-root' }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: vi.fn(),
    nativeLiveGraphSessionOffered: vi.fn(),
    startNativeLiveGraphSession: vi.fn(),
    // The rate the native session is told to place its programme on, and the
    // clock the hold dates its release by. A live context is not needed for
    // either.
    getAudioContext: (): { sampleRate: number; currentTime: number } => ({
        sampleRate: 48_000,
        currentTime: audioClock.currentTime,
    }),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));
vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
}));
vi.mock('../../playheadScheduler/prepareInitialBrowserPlayback', () => ({ prepareInitialBrowserPlayback: vi.fn() }));
vi.mock('../stopPlayback', () => ({ stopPlayback: vi.fn(async () => undefined) }));
vi.mock('../../playheadScheduler/claimSchedulerSession', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../playheadScheduler/claimSchedulerSession')>();
    return { claimSchedulerSession: vi.fn(actual.claimSchedulerSession) };
});
vi.mock('../../ensureTrackStrips', () => ({
    ensureTrackStrips: vi.fn(),
}));

function publishTransportPatch(patch: Parameters<typeof updateTransportState>[0]): void {
    const current = getTransportState();
    if (current) {
        vi.mocked(getTransportState).mockReturnValue({ ...current, ...patch });
    }
}

describe('startPlayback', () => {
    beforeEach(() => {
        playheadPositionRef.current = 0;
        playheadWrapCountRef.current = 0;
        timeSignatureMapStore.value = { changes: [] };
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockReset();
        vi.mocked(updateTransportState).mockImplementation(publishTransportPatch);
        vi.mocked(resumeEngine).mockReset();
        // resumeEngine returns Promise<void>; default to a resolved promise so
        // the `.catch` chain in startPlayback has a thenable to attach to.
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(startNativeLiveGraphSession).mockReset();
        // Declining is what a browser build answers, so it is the default here:
        // every case that is not about the native engine must pass with one.
        vi.mocked(startNativeLiveGraphSession).mockResolvedValue({
            outcome: 'declined',
            reason: 'no desktop bridge (browser runtime)',
        });
        vi.mocked(nativeLiveGraphSessionOffered).mockReset();
        // A browser build is the default runtime here, so the cases that say
        // nothing about the native engine take the unheld path they always had.
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(false);
        vi.mocked(notifyUser).mockClear();
        vi.mocked(startPlayheadScheduler).mockReset();
        vi.mocked(startPlayheadScheduler).mockImplementation((prepared) =>
            prepared ? Promise.resolve(true) : undefined
        );
        vi.mocked(prepareInitialBrowserPlayback).mockImplementation((generation) => ({
            generation,
            epoch: schedulerSession.discontinuityEpoch,
            seam: null,
            ownsSession: () => true,
            isCurrent: () => true,
            yeastRouteLineage: new Map(),
            prepareMidiWindows: async () => ({
                isCurrent: () => true,
                midiWindow: () => {
                    throw new Error('Scheduler boundary is mocked in this spec');
                },
            }),
        }));
        vi.mocked(ensureTrackStrips).mockClear();
        vi.mocked(stopPlayback).mockClear();
        // Back to the real retirement: only the one isolation case overrides it.
        vi.mocked(claimSchedulerSession).mockReset();
    });

    it('should resume engine and mark playing when state exists', () => {
        const update = vi.fn<typeof updateTransportState>(publishTransportPatch);
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 8,
            preRollEnabled: false,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(resumeEngine).toHaveBeenCalled();
        expect(ensureTrackStrips).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 8 });
        expect(playheadPositionRef.current).toBe(8);
        expect(startPlayheadScheduler).toHaveBeenCalled();
    });

    it('surfaces a failed engine resume to the user while still starting playback', async () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 0,
            preRollEnabled: false,
        });
        vi.mocked(resumeEngine).mockRejectedValue(new Error('resume blocked'));

        startPlayback();

        // The transport still advances (resume is best-effort), but the rejection
        // is no longer swallowed — the user is warned to re-arm audio.
        expect(startPlayheadScheduler).toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('suspended'), 'warning');
        });
    });

    it('reports a synchronous preparation failure to a gesture caller', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: false });
        vi.mocked(ensureTrackStrips).mockImplementationOnce(() => {
            throw new Error('strip unavailable');
        });

        await expect(startPlayback()).resolves.toBeUndefined();

        expect(updateTransportState).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('Playback'), 'error');
    });

    it('awaits browser admission and passes the recording anchor callback to its owner', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: false });
        const admission = Promise.withResolvers<boolean>();
        vi.mocked(startPlayheadScheduler).mockReturnValue(admission.promise);
        const onRoll = vi.fn<(contextSeconds: number, beat: number) => void>();
        let settled = false;
        const playback = startPlayback(onRoll).then(() => {
            settled = true;
        });
        const schedulerCall = vi.mocked(startPlayheadScheduler).mock.calls[0];
        expect(schedulerCall?.[0]).toBeDefined();
        expect(schedulerCall?.[1]).toBe(onRoll);
        expect(settled).toBe(false);
        expect(onRoll).not.toHaveBeenCalled();
        schedulerCall?.[1]?.(10.1, 4);
        admission.resolve(true);
        await playback;
        expect(settled).toBe(true);
        expect(onRoll).toHaveBeenCalledExactlyOnceWith(10.1, 4);
    });

    it('rolls in over the bars the time-signature map defines, not the flat numerator', () => {
        // 4/4 until beat 6, 3/4 from there. The two bars before beat 12 are both
        // 3/4 (beats 9..12 and 6..9), so a 2-bar pre-roll opens at beat 6.
        // Multiplying the transport numerator gave 12 - 2*4 = 4 — a beat and a
        // half early, and not on a bar line at all.
        timeSignatureMapStore.value = {
            changes: [
                { id: 'ts-a', beat: 0, numerator: 4, denominator: 4 },
                { id: 'ts-b', beat: 6, numerator: 3, denominator: 4 },
            ],
        };
        const update = vi.fn<typeof updateTransportState>(publishTransportPatch);
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 12,
            preRollEnabled: true,
            preRollBars: 2,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 6 });
        expect(playheadPositionRef.current).toBe(6);
    });

    it('opens the pre-roll on a real bar line when a meter change lands mid-bar', () => {
        // 3/4 arriving at beat 5, one quarter into the second 4/4 bar. Nothing
        // snaps a change to a bar line, so this is an ordinary project state. Bar
        // lines run 0, 4, 5, 8, 11, and a 3-bar pre-roll from 11 must open at 4.
        // Subtracting bar lengths walked 8, 5, then 1 — three quarter notes early
        // and not a bar line at all, so the count came in off the bar.
        timeSignatureMapStore.value = {
            changes: [{ id: 'ts-a', beat: 5, numerator: 3, denominator: 4 }],
        };
        const update = vi.fn<typeof updateTransportState>(publishTransportPatch);
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 11,
            preRollEnabled: true,
            preRollBars: 3,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 4 });
        expect(playheadPositionRef.current).toBe(4);
    });

    it('sizes a pre-roll bar by the meter denominator, not by the numerator alone', () => {
        // 6/8 bars are three quarter notes long, so two of them reach back six
        // beats from 12. Treating the numerator as quarter notes reached back
        // twelve and started the pre-roll at the timeline origin.
        const update = vi.fn<typeof updateTransportState>(publishTransportPatch);
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 12,
            preRollEnabled: true,
            preRollBars: 2,
            timeSignatureNumerator: 6,
            timeSignatureDenominator: 8,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 6 });
    });

    it('clamps a pre-roll that reaches back past the timeline origin', () => {
        const update = vi.fn<typeof updateTransportState>(publishTransportPatch);
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 2,
            preRollEnabled: true,
            preRollBars: 2,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 0 });
    });

    it('starts the native live graph session at the beat playback actually opens on', () => {
        // 4/4 at 120 BPM, so the 2-bar pre-roll opens at beat 4 — two seconds in.
        // Sending the raw playhead would start the native engine four seconds
        // ahead of the Web Audio transport it is meant to shadow.
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 12,
            preRollEnabled: true,
            preRollBars: 2,
        });

        startPlayback();

        const request = vi.mocked(startNativeLiveGraphSession).mock.calls[0]?.[0];
        // The beat play opens on is the whole of the position, and the start is
        // held: the scheduler waits for this session, so nothing sounds in
        // between and the engine owes the material there. #4020 rolled this
        // start at wherever Web Audio would have reached, and that locate
        // seeked past every note-on stamped in between with nothing else to
        // sound them.
        expect(request).toEqual(
            expect.objectContaining({
                positionSeconds: 2,
                transport: { kind: 'held', webAudioRollingSince: expect.any(Function) },
            })
        );
    });

    it('gives the native session the arrangement maps the engine has to follow', () => {
        vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 0,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
        });

        startPlayback();

        // Beats out, seconds in: at the default 120 BPM the loop spans beats
        // 4..8, which is two to four seconds on the engine's clock.
        expect(startNativeLiveGraphSession).toHaveBeenCalledWith(
            expect.objectContaining({
                transportMaps: expect.objectContaining({
                    loopRegion: { enabled: true, startSeconds: 2, endSeconds: 4 },
                }),
            })
        );
    });

    it('should not start when transport state is missing', () => {
        const update = vi.fn<typeof updateTransportState>(publishTransportPatch);
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(resumeEngine).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('should be a no-op when already playing so a duplicate trigger does not re-snap the scheduler', () => {
        const update = vi.fn<typeof updateTransportState>(publishTransportPatch);
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            playheadPosition: 8,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        // Re-running while playing would re-call startPlayheadScheduler, which
        // re-snaps lastTickTime and costs one tick of playhead advance.
        expect(resumeEngine).not.toHaveBeenCalled();
        expect(ensureTrackStrips).not.toHaveBeenCalled();
        expect(startPlayheadScheduler).not.toHaveBeenCalled();
        expect(startNativeLiveGraphSession).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    /**
     * On a desktop build the play gesture starts two carriers of one
     * arrangement, and they have to open at the same beat: the session's MIDI
     * arm queues its note pass from the beat play opens on, and the engine
     * delivers only the notes at or after the block it begins rendering. So
     * Web Audio waits for the engine's answer rather than the engine skipping
     * forward to Web Audio.
     */
    describe('holding the Web Audio start for the native session', () => {
        // `startPlayback` commits `isPlaying: true` before the hold opens and
        // the hold reads the flag back at the end of the wait, so the store has
        // to carry the write rather than answer one fixed snapshot.
        let transportState: TransportState = defaultTransportState;
        /** One macrotask drains the whole chain: session → then → catch → race → await. */
        const drainHold = (): Promise<void> =>
            new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        /**
         * What the session's own roll would read out of the held transport it
         * was started with: `null` for as long as the hold stands, and the
         * context instant Web Audio opened at once the hold has given up.
         */
        const webAudioRollingSince = (): number | null | undefined => {
            const transport = vi.mocked(startNativeLiveGraphSession).mock.calls[0]?.[0].transport;
            if (transport?.kind !== 'held') {
                return undefined;
            }
            return transport.webAudioRollingSince();
        };

        beforeEach(() => {
            audioClock.currentTime = 0;
            transportState = {
                ...defaultTransportState,
                isPlaying: false,
                playheadPosition: 0,
                preRollEnabled: false,
            };
            vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(true);
            vi.mocked(getTransportState).mockImplementation(() => transportState);
            vi.mocked(updateTransportState).mockImplementation((patch) => {
                transportState = { ...transportState, ...patch };
            });
        });

        it('receipts the actual admitted roll beat after a position changes during the hold', async () => {
            let settle!: (result: Awaited<ReturnType<typeof startNativeLiveGraphSession>>) => void;
            vi.mocked(startNativeLiveGraphSession).mockReturnValue(
                new Promise((resolve) => {
                    settle = resolve;
                })
            );
            const onRoll = vi.fn();
            const starting = startPlayback(onRoll);
            transportState = { ...transportState, playheadPosition: 12 };
            audioClock.currentTime = 51;
            vi.mocked(startPlayheadScheduler).mockImplementationOnce(() => {
                playheadClockRef.beat = transportState.playheadPosition;
                playheadClockRef.audioTimeSeconds = audioClock.currentTime;
            });
            settle({ outcome: 'started', runtimeRevision: 1, reports: [] });
            await starting;
            expect(onRoll).toHaveBeenCalledExactlyOnceWith(51, 12);
        });

        it('does not start the scheduler until the native session has answered', async () => {
            audioClock.currentTime = 3.25;
            let rollingSinceAtRoll: number | null | undefined = 0;
            vi.mocked(startNativeLiveGraphSession).mockImplementation(async () => {
                // Where the real session reads the hold: once, at the end of its
                // own round trips, immediately before it rolls.
                await Promise.resolve();
                rollingSinceAtRoll = webAudioRollingSince();
                return { outcome: 'started', runtimeRevision: 1, reports: [] };
            });

            startPlayback();

            expect(startPlayheadScheduler).not.toHaveBeenCalled();
            await drainHold();
            expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
            // The hold stood for the whole start, so the roll happened where
            // play asked and had nothing to catch up to. A release written
            // before the wait would read 3.25 here and seek the engine past
            // material Web Audio never sounded.
            expect(rollingSinceAtRoll).toBeNull();
        });

        it('hands recording the admitted native scheduler anchor after the hold ends', async () => {
            const session = Promise.withResolvers<void>();
            vi.mocked(startNativeLiveGraphSession).mockImplementation(async () => {
                await session.promise;
                return { outcome: 'declined', reason: 'controlled native admission' };
            });
            vi.mocked(startPlayheadScheduler).mockImplementation(() => {
                playheadClockRef.audioTimeSeconds = audioClock.currentTime;
                playheadClockRef.beat = 4;
            });
            const onRoll = vi.fn<(contextSeconds: number, beat: number) => void>();
            const playback = startPlayback(onRoll);
            expect(onRoll).not.toHaveBeenCalled();
            audioClock.currentTime = 10.08;
            session.resolve();
            await playback;
            expect(onRoll).toHaveBeenCalledExactlyOnceWith(10.08, 4);
        });

        it('starts the scheduler once when the native session fails, so a dead addon cannot silence play', async () => {
            vi.mocked(startNativeLiveGraphSession).mockRejectedValue(new Error('addon crashed'));

            startPlayback();

            await drainHold();
            expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
        });

        it('stops the admitted roll when native scheduler startup fails', async () => {
            vi.mocked(startPlayheadScheduler).mockImplementationOnce(() => {
                throw new Error('worker unavailable');
            });

            await expect(startPlayback()).resolves.toBeUndefined();

            expect(stopPlayback).toHaveBeenCalledOnce();
            expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('Playback'), 'error');
        });

        it('leaves the transport alone when the play it was holding for has already ended', async () => {
            audioClock.currentTime = 3.25;
            let answer = (): void => {};
            vi.mocked(startNativeLiveGraphSession).mockReturnValue(
                new Promise((resolve) => {
                    answer = (): void => {
                        resolve({ outcome: 'started', runtimeRevision: 1, reports: [] });
                    };
                })
            );

            startPlayback();
            // What a stop, pause, seek-while-playing or dispose does inside the
            // hold: each bumps the scheduler generation. `isPlaying` would not
            // catch this — it is shared by every play, so a stop and a second
            // play inside the hold leave it true and this continuation would
            // re-snap the new play's scheduler.
            schedulerSession.generation += 1;
            answer();

            await drainHold();
            expect(startPlayheadScheduler).not.toHaveBeenCalled();
            // And the session is still owed a roll at the beat play asked for.
            // A release written before the guard would answer 3.25 here, and
            // the engine would seek there for a transport that never opened.
            expect(webAudioRollingSince()).toBeNull();
        });

        it('leaves a transport paused inside the hold alone, before the pause has bumped the generation', async () => {
            audioClock.currentTime = 3.25;
            let answer = (): void => {};
            vi.mocked(startNativeLiveGraphSession).mockReturnValue(
                new Promise((resolve) => {
                    answer = (): void => {
                        resolve({ outcome: 'started', runtimeRevision: 1, reports: [] });
                    };
                })
            );

            void startPlayback();
            // What `pausePlayback` does inside the hold while recording: it
            // commits `isPlaying: false` straight away and only bumps the
            // generation behind its recording flush, so the wait can end
            // carrying the generation it opened on. Starting the scheduler here
            // would roll a paused transport.
            transportState = { ...transportState, isPlaying: false };
            answer();

            await drainHold();
            expect(startPlayheadScheduler).not.toHaveBeenCalled();
            // Same duty under the pause: nothing was released, so the session
            // still rolls where play asked rather than projecting past material
            // a paused Web Audio never sounded.
            expect(webAudioRollingSince()).toBeNull();
        });

        it('gives up on the native session after the hold cap rather than never starting', async () => {
            vi.useFakeTimers();
            audioClock.currentTime = 3.25;
            let answer = (): void => {};
            vi.mocked(startNativeLiveGraphSession).mockReturnValue(
                new Promise((resolve) => {
                    answer = (): void => {
                        resolve({ outcome: 'started', runtimeRevision: 1, reports: [] });
                    };
                })
            );

            try {
                void startPlayback();

                // The cap is what releases the wait here — the session never
                // answers — so the hold has to still be holding one millisecond
                // short of it.
                await vi.advanceTimersByTimeAsync(249);
                expect(startPlayheadScheduler).not.toHaveBeenCalled();
                // And the session, asked now, would still roll where play asked.
                expect(webAudioRollingSince()).toBeNull();

                await vi.advanceTimersByTimeAsync(1);
                expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
                // Web Audio is rolling from 3.25 now, so the session — still
                // starting, since it has not answered — has to project its roll
                // from there. Left unsaid, the engine would roll at the parked
                // position a cap behind a transport nobody stopped.
                expect(webAudioRollingSince()).toBe(3.25);

                // The session answering after the cap has nothing left to start:
                // the transport is already rolling on the fallback.
                answer();
                await vi.advanceTimersByTimeAsync(250);
                expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('retires the scheduler session a pause left ticking the moment Play is pressed', async () => {
            let answer = (): void => {};
            vi.mocked(startNativeLiveGraphSession).mockReturnValue(
                new Promise((resolve) => {
                    answer = (): void => {
                        resolve({ outcome: 'started', runtimeRevision: 1, reports: [] });
                    };
                })
            );
            // A pause whose teardown is still queued behind its recording flush
            // leaves this session's worker posting ticks, and the flush's
            // continuation stands down once Play flips `isPlaying` back. Only
            // the generation retires those ticks, and it has to happen before
            // the hold, not after it.
            const pausedGeneration = schedulerSession.generation;

            void startPlayback();

            expect(schedulerSession.generation).toBeGreaterThan(pausedGeneration);

            answer();
            await drainHold();
            expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
        });

        it('drops the dead roll wrap count beside the epoch write, while the hold still stands', () => {
            // The previous roll wrapped twice; the claiming play retires its
            // session and writes a fresh epoch before the hold opens. The
            // scheduler that resets the count beside its own clock anchor only
            // starts after the hold, so a capture in the hold would otherwise
            // bound old events by the dead roll's wraps. The claim zeroes the
            // count too, so its zero is stood down here — the retirement kept —
            // or this case could not tell the epoch write's zero from the
            // claim's. `claimSchedulerSession.spec.ts` pins the claim's zero.
            vi.mocked(claimSchedulerSession).mockImplementation(() => {
                schedulerSession.generation += 1;
                return schedulerSession.generation;
            });
            try {
                playheadWrapCountRef.current = 2;

                startPlayback();

                // The epoch write and the reset are synchronous, and the session
                // has not answered, so the zero below can only have come from
                // the epoch write beside it.
                expect(startPlayheadScheduler).not.toHaveBeenCalled();
                expect(playheadWrapCountRef.current).toBe(0);
            } finally {
                vi.mocked(claimSchedulerSession).mockReset();
            }
        });

        it('hands browser admission to the scheduler without asking for a native session', () => {
            vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(false);

            startPlayback();

            expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
            expect(startNativeLiveGraphSession).not.toHaveBeenCalled();
        });
    });
});
