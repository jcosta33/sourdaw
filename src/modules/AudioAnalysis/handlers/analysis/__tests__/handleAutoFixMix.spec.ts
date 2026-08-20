import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { isAppActionCommittedError } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { analyzeMix, type AnalyzeMixOutput } from '../../../useCases/analyzeMix';
import { handleAutoFixMix } from '../handleAutoFixMix';

type TrackStateForMixAnalysis = {
    tracks: Array<{ id: string; gain?: number }>;
};

type TrackLevel = AnalyzeMixOutput['trackLevels'][number];

const mocks = vi.hoisted(() => ({
    beginLifecycle: vi.fn<() => number | null>(),
    completeLifecycle: vi.fn<(input: { token: number; result: AnalyzeMixOutput }) => void>(),
    failLifecycle: vi.fn<(input: { token: number }) => void>(),
    executeAppAction: vi.fn<(action: AppAction, options?: { shouldExecute?: () => boolean }) => void | Promise<void>>(),
    getTrackStoreState: vi.fn<() => TrackStateForMixAnalysis | null>(),
    getTransportState: vi.fn<() => { masterGain: number } | null>(),
    loggerError: vi.fn(),
}));

vi.mock('../../../useCases/mixAnalysisDisplayLifecycle', () => ({
    mixAnalysisDisplayLifecycle: {
        begin: mocks.beginLifecycle,
        complete: mocks.completeLifecycle,
        fail: mocks.failLifecycle,
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.loggerError },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

vi.mock('../../../useCases/analyzeMix', () => ({
    analyzeMix: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (import_original) => ({
    ...(await import_original<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
}));

function create_track_level(input: Partial<TrackLevel> & Pick<TrackLevel, 'trackId'>): TrackLevel {
    return {
        trackId: input.trackId,
        trackName: input.trackName ?? input.trackId,
        peakDb: input.peakDb ?? -10,
        rmsDb: input.rmsDb ?? -20,
        isMuted: input.isMuted ?? false,
        isSoloed: input.isSoloed ?? false,
        isClipping: input.isClipping ?? false,
    };
}

type CreateAnalysisResultInput = {
    trackLevels?: AnalyzeMixOutput['trackLevels'];
    overallLevel?: Partial<AnalyzeMixOutput['overallLevel']>;
};

function create_analysis_result(input: CreateAnalysisResultInput = {}): AnalyzeMixOutput {
    return {
        timestamp: 1,
        overallLevel: {
            peakDb: -10,
            rmsDb: -20,
            ...input.overallLevel,
        },
        frequencyBalance: {
            sub: -80,
            bass: -70,
            lowMid: -60,
            mid: -50,
            highMid: -55,
            high: -65,
        },
        trackLevels: input.trackLevels ?? [],
        issues: [],
        suggestions: [],
    };
}

describe('handleAutoFixMix', () => {
    beforeEach(() => {
        mocks.beginLifecycle.mockReset();
        mocks.beginLifecycle.mockReturnValue(11);
        mocks.completeLifecycle.mockReset();
        mocks.failLifecycle.mockReset();
        mocks.executeAppAction.mockReset();
        mocks.getTrackStoreState.mockReset();
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.getTransportState.mockReset();
        mocks.getTransportState.mockReturnValue(null);
        mocks.loggerError.mockReset();
        vi.mocked(analyzeMix).mockReset();
    });

    it('should do nothing if store state is missing', async () => {
        mocks.beginLifecycle.mockReturnValue(null);
        await handleAutoFixMix.execute({ type: 'autoFixMix' });
        expect(analyzeMix).not.toHaveBeenCalled();
        expect(mocks.completeLifecycle).not.toHaveBeenCalled();
    });

    it('should set analyzing state and call analyzeMix', async () => {
        vi.mocked(analyzeMix).mockResolvedValue(create_analysis_result());

        await handleAutoFixMix.execute({ type: 'autoFixMix' });

        expect(mocks.beginLifecycle).toHaveBeenCalled();
        expect(analyzeMix).toHaveBeenCalled();
        const completed_lifecycle = mocks.completeLifecycle.mock.calls.at(-1)?.[0];

        if (!completed_lifecycle) {
            throw new Error('Expected lifecycle completion');
        }

        expect(completed_lifecycle.token).toBe(11);
        expect(completed_lifecycle.result.overallLevel.peakDb).toBe(-10);
    });

    it('should fix clipping tracks and master gain', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 0.8 }] });

        vi.mocked(analyzeMix).mockResolvedValueOnce(
            create_analysis_result({
                trackLevels: [create_track_level({ trackId: 't1', isClipping: true, peakDb: 2 })],
                overallLevel: { peakDb: -1 },
            })
        );

        // Post-correction re-read: the track is fixed but the master is still
        // over the ceiling, so the master reduction is still warranted.
        vi.mocked(analyzeMix).mockResolvedValueOnce(
            create_analysis_result({
                trackLevels: [create_track_level({ trackId: 't1', isClipping: false, peakDb: -6 })],
                overallLevel: { peakDb: -1 },
            })
        );

        vi.mocked(analyzeMix).mockResolvedValueOnce(create_analysis_result());

        await handleAutoFixMix.execute({ type: 'autoFixMix' });

        const actions = mocks.executeAppAction.mock.calls.map(([action]) => action);
        const track_gain_action = actions.find(
            (action): action is Extract<AppAction, { type: 'setTrackGain' }> =>
                action.type === 'setTrackGain' && action.payload.trackId === 't1'
        );

        if (!track_gain_action) {
            throw new Error('Expected setTrackGain call for track t1');
        }

        expect(track_gain_action.payload.trackId).toBe('t1');

        expect(actions.some((action) => action.type === 'setMasterGain')).toBe(true);
    });

    it('should reduce a clipping track relative to its current fader, not from the measured peak alone', async () => {
        // Two tracks with the *same* measured peak but different current faders.
        // The fix computes a relative reduction (same dB factor) applied to each
        // fader, so the louder fader ends up proportionally louder. The old code
        // derived an absolute gain from peakDb alone, giving both tracks the
        // identical result regardless of fader.
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'loud', gain: 0.9 },
                { id: 'quiet', gain: 0.3 },
            ],
        });

        vi.mocked(analyzeMix).mockResolvedValueOnce(
            create_analysis_result({
                trackLevels: [
                    create_track_level({ trackId: 'loud', isClipping: true, peakDb: 2 }),
                    create_track_level({ trackId: 'quiet', isClipping: true, peakDb: 2 }),
                ],
            })
        );
        vi.mocked(analyzeMix).mockResolvedValueOnce(create_analysis_result());

        await handleAutoFixMix.execute({ type: 'autoFixMix' });

        const gainCalls = mocks.executeAppAction.mock.calls
            .map(([action]) => action)
            .filter((action): action is Extract<AppAction, { type: 'setTrackGain' }> => action.type === 'setTrackGain');
        const loud = gainCalls.find((action) => action.payload.trackId === 'loud');
        const quiet = gainCalls.find((action) => action.payload.trackId === 'quiet');

        if (!loud || !quiet) {
            throw new Error('Expected setTrackGain calls for loud and quiet tracks');
        }

        // Same overshoot -> same reduction factor; applied to each current fader.
        const overshootDb = 2 - -0.5; // peak - clip threshold
        const factor = 10 ** (-(overshootDb + 3) / 20);
        expect(loud.payload.gain).toBeCloseTo(0.9 * factor, 6);
        expect(quiet.payload.gain).toBeCloseTo(0.3 * factor, 6);
        // The two faders must NOT collapse to one value (the old peak-derived bug).
        expect(loud.payload.gain).not.toBeCloseTo(quiet.payload.gain, 6);
        expect(loud.payload.gain).toBeGreaterThan(quiet.payload.gain);
    });

    it('should refresh the analysis only after waiting for the analyser to settle', async () => {
        vi.useFakeTimers();
        try {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 0.8 }] });

            const initial_result = create_analysis_result({
                trackLevels: [create_track_level({ trackId: 't1', isClipping: true, peakDb: 2 })],
            });
            const refreshed_result = create_analysis_result({ overallLevel: { peakDb: -12 } });

            vi.mocked(analyzeMix).mockResolvedValueOnce(initial_result).mockResolvedValueOnce(refreshed_result);

            const done = handleAutoFixMix.execute({ type: 'autoFixMix' });

            // Let the initial analyze + gain dispatches flush, but do NOT advance
            // wall-clock time yet. The refresh must be gated behind the settle
            // delay, so analyzeMix has been called exactly once so far.
            await vi.advanceTimersByTimeAsync(0);
            expect(analyzeMix).toHaveBeenCalledTimes(1);

            // Advancing past the settle window releases the refresh.
            await vi.advanceTimersByTimeAsync(250);
            await done;
            expect(analyzeMix).toHaveBeenCalledTimes(2);
            expect(mocks.completeLifecycle).toHaveBeenLastCalledWith({
                token: 11,
                result: refreshed_result,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops before the delayed refresh when the command signal aborts', async () => {
        vi.useFakeTimers();
        const action = { type: 'autoFixMix' } as const;
        const controller = new AbortController();
        vi.mocked(analyzeMix).mockResolvedValue(create_analysis_result());

        const execution = handleAutoFixMix.execute(action, {
            actions: [action],
            actionIndex: 0,
            signal: controller.signal,
        });
        let settled = false;
        const outcome = Promise.resolve(execution).then(
            () => undefined,
            (error: unknown) => error
        );
        void outcome.then(() => {
            settled = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        await vi.advanceTimersByTimeAsync(0);
        const stoppedBeforeSettleDelay = settled;
        await vi.advanceTimersByTimeAsync(250);
        await outcome;

        expect(stoppedBeforeSettleDelay).toBe(true);
        expect(analyzeMix).toHaveBeenCalledOnce();
    });

    it('should log the error and reset analyzing state on error', async () => {
        const failure = new Error('crash');
        vi.mocked(analyzeMix).mockRejectedValue(failure);

        await expect(handleAutoFixMix.execute({ type: 'autoFixMix' })).rejects.toBe(failure);

        expect(mocks.loggerError).toHaveBeenCalledWith(failure);
        expect(mocks.failLifecycle).toHaveBeenCalledWith({ token: 11 });
    });

    it('should preserve an earlier fix and reject when a later fix fails', async () => {
        const later_failure = new Error('second gain update failed');
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'first', gain: 0.8 },
                { id: 'second', gain: 0.7 },
            ],
        });
        vi.mocked(analyzeMix).mockResolvedValue(
            create_analysis_result({
                trackLevels: [
                    create_track_level({ trackId: 'first', isClipping: true, peakDb: 2 }),
                    create_track_level({ trackId: 'second', isClipping: true, peakDb: 1 }),
                ],
            })
        );
        mocks.executeAppAction.mockResolvedValueOnce(undefined).mockRejectedValueOnce(later_failure);

        let reported_error: unknown;
        try {
            await handleAutoFixMix.execute({ type: 'autoFixMix' });
        } catch (error) {
            reported_error = error;
        }

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppAction.mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({ type: 'setTrackGain', payload: expect.objectContaining({ trackId: 'first' }) })
        );
        expect(mocks.failLifecycle).toHaveBeenCalledWith({ token: 11 });
        expect(mocks.loggerError).toHaveBeenCalledWith(later_failure);
        expect(isAppActionCommittedError(reported_error)).toBe(true);
    });

    it('should reduce the master fader relative to its current position, not from the measured peak alone', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.getTransportState.mockReturnValue({ masterGain: 20 }); // 20% = 0.2

        // No clipping tracks, so the post-correction re-read still measures the
        // same hot master: the reduction is driven by a live -1 dBFS peak.
        vi.mocked(analyzeMix).mockResolvedValue(
            create_analysis_result({
                trackLevels: [],
                overallLevel: { peakDb: -1 },
            })
        );

        await handleAutoFixMix.execute({ type: 'autoFixMix' });

        const masterCall = mocks.executeAppAction.mock.calls
            .map(([action]) => action)
            .find((action): action is Extract<AppAction, { type: 'setMasterGain' }> => action.type === 'setMasterGain');

        if (!masterCall) {
            throw new Error('Expected setMasterGain call');
        }

        // Overshoot = -1 - (-6) = +5 dB. Factor = 10 ** (-5 / 20) = 0.56234
        // Expected gain = 0.2 * 0.56234 ≈ 0.112468
        // Old bug gave 10 ** (-6 / 20) ≈ 0.501187 (which would boost a 0.2 fader)
        expect(masterCall.payload.gain).toBeLessThan(0.2);
        expect(masterCall.payload.gain).toBeCloseTo(0.2 * 10 ** (-5 / 20), 5);
        // The percent the reduction was derived from rides along, so Transport
        // can reject the write if the fader moved before admission.
        expect(masterCall.payload.expectedPercent).toBe(20);
    });

    it('should not attenuate the master again when the track correction already brought it under target', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', gain: 0.8 }] });
        mocks.getTransportState.mockReturnValue({ masterGain: 80 });

        // The master reads -1 dBFS — over the -3 trigger — but the clipping
        // track is what drives it there.
        vi.mocked(analyzeMix).mockResolvedValueOnce(
            create_analysis_result({
                trackLevels: [create_track_level({ trackId: 't1', isClipping: true, peakDb: 2 })],
                overallLevel: { peakDb: -1 },
            })
        );
        // Attenuating that one track lands the mix at -8 dBFS, already below the
        // -6 dBFS target. Deciding the master from the stale -1 dBFS peak would
        // pull a further 5 dB off an already-corrected mix, landing it at -13.
        vi.mocked(analyzeMix).mockResolvedValueOnce(
            create_analysis_result({
                trackLevels: [create_track_level({ trackId: 't1', isClipping: false, peakDb: -6 })],
                overallLevel: { peakDb: -8 },
            })
        );

        await handleAutoFixMix.execute({ type: 'autoFixMix' });

        const actions = mocks.executeAppAction.mock.calls.map(([action]) => action);
        expect(actions.filter((action) => action.type === 'setTrackGain')).toHaveLength(1);
        expect(actions.some((action) => action.type === 'setMasterGain')).toBe(false);
    });

    it('should not overwrite a master fader move that lands between the snapshot and admission', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.getTransportState.mockReturnValue({ masterGain: 80 });
        vi.mocked(analyzeMix).mockResolvedValue(create_analysis_result({ overallLevel: { peakDb: -1 } }));

        let live_master_percent = 80;
        const committed_master_percents: number[] = [];
        mocks.executeAppAction.mockImplementation(async (action) => {
            if (action.type !== 'setMasterGain') {
                return;
            }
            // Another writer moves the fader while this command waits for
            // admission, exactly the gap the snapshot cannot see.
            live_master_percent = 50;
            await Promise.resolve();
            // Transport's guard, as `handleSetMasterGain` implements it.
            if (
                action.payload.expectedPercent !== undefined &&
                action.payload.expectedPercent !== live_master_percent
            ) {
                throw new Error('conflict: master gain diverged');
            }
            committed_master_percents.push(action.payload.gain * 100);
        });

        await expect(handleAutoFixMix.execute({ type: 'autoFixMix' })).rejects.toThrow(/conflict/);

        // The mover's 50% survives; the stale-derived target never lands.
        expect(committed_master_percents).toEqual([]);
        expect(live_master_percent).toBe(50);
    });

    it('should not commit a master write when the signal aborts during command admission', async () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        mocks.getTransportState.mockReturnValue({ masterGain: 80 });
        vi.mocked(analyzeMix).mockResolvedValue(create_analysis_result({ overallLevel: { peakDb: -1 } }));

        const controller = new AbortController();
        const committed: AppAction[] = [];
        let admission_reached = false;
        mocks.executeAppAction.mockImplementation(async (action, options) => {
            // Stand in for the awaited snapshot transaction inside
            // `executeAppAction`: cancellation lands after the caller's pre-call
            // abort check has already passed.
            admission_reached = true;
            controller.abort();
            await Promise.resolve();
            if (options?.shouldExecute && !options.shouldExecute()) {
                return; // declined at admission: no write, and no throw
            }
            committed.push(action);
        });

        const action = { type: 'autoFixMix' } as const;
        let reported_error: unknown;
        try {
            await handleAutoFixMix.execute(action, { actions: [action], actionIndex: 0, signal: controller.signal });
        } catch (error) {
            reported_error = error;
        }

        expect(admission_reached).toBe(true);
        expect(committed).toEqual([]);
        // Nothing was committed, so the cancellation must not be reported as a
        // committed mutation — that is how success would get recorded.
        expect(isAppActionCommittedError(reported_error)).toBe(false);
        expect(mocks.failLifecycle).toHaveBeenCalledWith({ token: 11 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });
});
