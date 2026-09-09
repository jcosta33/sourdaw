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
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { ensureTrackStrips } from '../../ensureTrackStrips';
// Real, not mocked: `generation` is the identity the hold compares, so bumping
// the live holder is the only way to test the relation it actually reads.
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { startPlayheadScheduler } from '../../playheadScheduler/startPlayheadScheduler';
import { startPlayback } from '../startPlayback';

const { timeSignatureMapStore } = vi.hoisted(
    (): { timeSignatureMapStore: { value: { changes: unknown[] } | null } } => ({
        timeSignatureMapStore: { value: { changes: [] } },
    })
);
vi.mock('../../../stores/timeSignatureMapStore', () => ({ timeSignatureMapStore }));
vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    resumeEngine: vi.fn(),
    nativeLiveGraphSessionOffered: vi.fn(),
    startNativeLiveGraphSession: vi.fn(),
    // The rate the native session is told to place its programme on. A device
    // rate is all `startPlayback` reads, so a live context is not needed here.
    getAudioContext: (): { sampleRate: number } => ({ sampleRate: 48_000 }),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));
vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
}));
vi.mock('../../ensureTrackStrips', () => ({
    ensureTrackStrips: vi.fn(),
}));

describe('startPlayback', () => {
    beforeEach(() => {
        playheadPositionRef.current = 0;
        timeSignatureMapStore.value = { changes: [] };
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
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
        vi.mocked(startPlayheadScheduler).mockClear();
        vi.mocked(ensureTrackStrips).mockClear();
    });

    it('should resume engine and mark playing when state exists', () => {
        const update = vi.fn<typeof updateTransportState>();
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
        const update = vi.fn<typeof updateTransportState>();
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
        const update = vi.fn<typeof updateTransportState>();
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
        const update = vi.fn<typeof updateTransportState>();
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
        const update = vi.fn<typeof updateTransportState>();
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
        expect(request).toEqual(expect.objectContaining({ positionSeconds: 2 }));
        // The beat play opens on is the whole of the position. #4020 added an
        // audio-clock anchor so the session could roll the engine at wherever
        // Web Audio had reached by the time it was ready; that locate seeked
        // past every note-on stamped in between, and nothing else sounded them.
        expect(request === undefined || 'anchoredAtContextSeconds' in request).toBe(false);
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
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(resumeEngine).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('should be a no-op when already playing so a duplicate trigger does not re-snap the scheduler', () => {
        const update = vi.fn<typeof updateTransportState>();
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

        beforeEach(() => {
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

        it('does not start the scheduler until the native session has answered', async () => {
            vi.mocked(startNativeLiveGraphSession).mockResolvedValue({
                outcome: 'started',
                runtimeRevision: 1,
                reports: [],
            });

            startPlayback();

            expect(startPlayheadScheduler).not.toHaveBeenCalled();
            await drainHold();
            expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
        });

        it('starts the scheduler once when the native session fails, so a dead addon cannot silence play', async () => {
            vi.mocked(startNativeLiveGraphSession).mockRejectedValue(new Error('addon crashed'));

            startPlayback();

            await drainHold();
            expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
        });

        it('leaves the transport alone when the play it was holding for has already ended', async () => {
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
        });

        it('leaves a transport paused inside the hold alone, before the pause has bumped the generation', async () => {
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
        });

        it('gives up on the native session after the hold cap rather than never starting', async () => {
            vi.useFakeTimers();
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

                await vi.advanceTimersByTimeAsync(1);
                expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);

                // The session answering after the cap has nothing left to start:
                // the transport is already rolling on the fallback.
                answer();
                await vi.advanceTimersByTimeAsync(250);
                expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('starts the scheduler synchronously on a browser build, which is offered no session to wait for', () => {
            vi.mocked(nativeLiveGraphSessionOffered).mockReturnValue(false);

            startPlayback();

            expect(startPlayheadScheduler).toHaveBeenCalledTimes(1);
            expect(startNativeLiveGraphSession).not.toHaveBeenCalled();
        });
    });
});
