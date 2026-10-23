import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke } from '#/utils/desktopBridge';

import { nativeEnginePlayheadFeed, pollNativeEnginePlayheadOnce } from '../nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { createNativeRecordingCaptureClock, nativeRecordingCaptureClockState } from '../nativeRecordingCaptureClock';
import { startNativeEnginePlayheadFeed } from '../startNativeEnginePlayheadFeed';
import { stopNativeEnginePlayheadFeed } from '../stopNativeEnginePlayheadFeed';

vi.mock('#/utils/desktopBridge', () => ({ isDesktopRuntime: () => true, desktopInvoke: vi.fn() }));
vi.mock('#/utils/DOM/AnimationScheduler', () => ({ animationScheduler: { register: vi.fn(), unregister: vi.fn() } }));

describe('dated native recording capture through the real parser and feed', () => {
    let rendererSeconds = 100;
    const geometry = {
        secondsAtBeat: (beat: number) => beat / 2,
        beatAtSeconds: (seconds: number) => seconds * 2,
        isLooping: true,
        loopStart: 8,
        loopEnd: 12,
    };
    const context = {
        state: 'running' as AudioContextState,
        getOutputTimestamp: () => ({ contextTime: 50.8, performanceTime: 100000 }),
    };
    const payload = (enteredSeconds = 20.001, leavingSeconds = 20.003) => ({
        running: true,
        playing: true,
        positionSeconds: 5,
        playheadFrame: 240000,
        loopWraps: 0,
        batchesApplied: 7,
        captureClock: {
            epoch: 1,
            streamEpoch: 1,
            sampleRate: 48000,
            presentationSeconds: 20.1,
            quality: 'estimated',
            uncertaintySeconds: null,
        },
        captureClockQuery: { epoch: 1, enteredSeconds, leavingSeconds },
    });

    beforeEach(() => {
        stopNativeEnginePlayheadFeed();
        nativeEnginePlayheadFeed.inFlightEpoch = null;
        nativeLiveGraphSession.captureAdmissions = [];
        nativeLiveGraphSession.audibleCarrier = true;
        rendererSeconds = 100;
        vi.spyOn(performance, 'now').mockImplementation(() => rendererSeconds * 1000);
        vi.mocked(desktopInvoke).mockReset();
        nativeRecordingCaptureClockState.retainAdmission(geometry, 7);
        startNativeEnginePlayheadFeed();
    });
    afterEach(() => {
        stopNativeEnginePlayheadFeed();
        nativeLiveGraphSession.audibleCarrier = false;
        vi.restoreAllMocks();
    });

    async function poll(reading: unknown, sent: number, received: number) {
        nativeEnginePlayheadFeed.reading = null;
        rendererSeconds = sent;
        vi.mocked(desktopInvoke).mockResolvedValueOnce(reading);
        pollNativeEnginePlayheadOnce();
        rendererSeconds = received;
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.reading).not.toBeNull());
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.inFlightEpoch).toBeNull());
    }

    it.each([0, 0.005, 0.05, 0.15])(
        'removes cached sample and later reply age %ss using independent calibration',
        async (lag) => {
            await poll(payload(), 100, 100.004);
            const owner = createNativeRecordingCaptureClock();
            const first = owner.read(context);
            expect(first).toMatchObject({ carrier: 'native', status: 'available' });
            if (first.carrier !== 'native' || first.status !== 'available') {
                throw new Error('Missing real clock');
            }
            expect(first.snapshot.contextSeconds).toBeCloseTo(50.9, 10);
            expect(first.snapshot.uncertaintySeconds).toBeCloseTo(0.001, 10);
            expect(first.snapshot.localUncertaintySeconds).toBeNull();
            await poll(payload(20.2, 20.202), 100.199, 100.204 + lag);
            const later = owner.read(context);
            if (later.carrier !== 'native' || later.status !== 'available') {
                throw new Error('Lost real clock');
            }
            const seam = later.snapshot.contextSeconds + 6 - later.snapshot.songSeconds;
            const sourceOrigin = 51.05 - (0.02 + 0.03 + 0.01);
            expect(seam).toBeCloseTo(51.9, 10);
            expect(Math.round((seam - sourceOrigin) * 48000)).toBe(43680);
            expect(later.snapshot.contextSeconds).toBe(first.snapshot.contextSeconds);
            expect(later.snapshot.uncertaintySeconds).toBe(first.snapshot.uncertaintySeconds);
            expect(later.snapshot.calibrationAgeSeconds).toBeCloseTo(0.2 + lag, 10);
            expect(later.snapshot.songSeconds + sourceOrigin - later.snapshot.contextSeconds).toBeCloseTo(5.09, 10);
        }
    );

    it('reports broad initial calibration uncertainty without asserting its midpoint as truth', async () => {
        await poll(payload(), 100, 100.154);
        const read = createNativeRecordingCaptureClock().read(context);
        expect(read).toMatchObject({ carrier: 'native', status: 'available' });
        if (read.carrier !== 'native' || read.status !== 'available') {
            throw new Error('Missing broad clock');
        }
        expect(read.snapshot.uncertaintySeconds).toBeCloseTo(0.076, 10);
        expect(read.snapshot.localUncertaintySeconds).toBeNull();
    });

    it('does not inject a source frame through large-origin cancellation on a real 5ms cached callback', async () => {
        const initial = payload(51, 51);
        await poll({ ...initial, captureClock: { ...initial.captureClock, presentationSeconds: 51 } }, 51, 51);
        const output = {
            state: 'running' as const,
            getOutputTimestamp: () => ({ contextTime: rendererSeconds, performanceTime: rendererSeconds * 1000 }),
        };
        const owner = createNativeRecordingCaptureClock();
        expect(owner.read(output)).toMatchObject({
            status: 'available',
            snapshot: { contextSeconds: 51, songSeconds: 5 },
        });
        const later = payload(52.1875, 52.1875);
        await poll(
            {
                ...later,
                positionSeconds: 4.1825,
                playheadFrame: 200760,
                loopWraps: 1,
                captureClock: { ...later.captureClock, presentationSeconds: 52.1825 },
            },
            52.1875,
            52.1875
        );
        const read = owner.read(output);
        if (read.carrier !== 'native' || read.status !== 'available') {
            throw new Error('Lost actual dated callback');
        }
        expect(read.snapshot.contextSeconds).toBe(52.1825);
        const seam = read.snapshot.contextSeconds - (read.snapshot.songSeconds - 4);
        expect(seam).toBe(52);
        expect((seam - 51) * 48000).toBe(48000);
        expect((52.25 - 51) * 48000).toBe(60000);
    });

    it('keeps native carrier identity without timing, and rejects an old map fence independently of writers', async () => {
        const owner = createNativeRecordingCaptureClock();
        expect(owner.read(context)).toEqual({ carrier: 'native', status: 'unavailable' });
        await poll({ ...payload(), batchesApplied: 6 }, 100, 100.004);
        expect(owner.read(context)).toEqual({ carrier: 'native', status: 'unavailable' });
        await poll(payload(20.2, 20.202), 100.199, 100.204);
        expect(owner.read(context)).toMatchObject({ carrier: 'native', status: 'available' });
        const retained = owner.last;
        await poll({ ...payload(20.3, 20.302), captureClock: null }, 100.299, 100.304);
        expect(owner.read(context)).toEqual({ carrier: 'native', status: 'unavailable' });
        expect(owner.last).toBe(retained);
    });

    it('retains an authentic admission stamp while output dating is unavailable', async () => {
        const owner = createNativeRecordingCaptureClock();
        expect(owner.admission).toBeNull();
        await poll(payload(), 100, 100.004);
        const admission = owner.admission;
        expect(admission).toMatchObject({ clockIdentity: '1:1' });
        expect(owner.read({ ...context, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) })).toEqual({
            carrier: 'native',
            status: 'unavailable',
        });
        await poll(payload(20.2, 20.202), 100.199, 100.204);
        expect(owner.read({ ...context, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) })).toEqual({
            carrier: 'native',
            status: 'unavailable',
        });
        expect(owner.admission).toEqual(admission);
        expect(owner.read(context)).toMatchObject({
            status: 'available',
            snapshot: { clockIdentity: admission!.clockIdentity, admission: { serial: admission!.serial } },
        });
    });

    it('does not authenticate an initially missing stamp with a later edited admission', async () => {
        await poll({ ...payload(), captureClock: null }, 100, 100.004);
        const owner = createNativeRecordingCaptureClock();
        const initialAdmission = owner.admission;
        expect(initialAdmission).toBeNull();
        const edited = { ...geometry, loopStart: 9 };
        nativeRecordingCaptureClockState.retainAdmission(edited, 9, true);
        await poll({ ...payload(20.2, 20.202), batchesApplied: 9 }, 100.199, 100.204);
        expect(owner.admission).toMatchObject({ clockIdentity: '1:1' });
        expect(owner.read(context)).toMatchObject({
            status: 'available',
            snapshot: { geometry: edited, admission: { admittedBatch: 9, located: true } },
        });
        expect(initialAdmission).toBeNull();
    });

    it('keeps future callback presentation distinct from the current output edge and stream replacement', async () => {
        await poll({ ...payload(), loopWraps: 1, positionSeconds: 4.01 }, 100, 100.004);
        const owner = createNativeRecordingCaptureClock();
        const read = owner.read(context);
        if (read.carrier !== 'native' || read.status !== 'available') {
            throw new Error('Missing future clock');
        }
        expect(read.snapshot.contextSeconds).toBeGreaterThan(read.snapshot.audibleContextSeconds);
        const replacement = payload(20.2, 20.202);
        await poll({ ...replacement, captureClock: { ...replacement.captureClock, streamEpoch: 2 } }, 100.199, 100.204);
        expect(owner.read(context)).toEqual({ carrier: 'native', status: 'unavailable' });
        expect(owner.last).toBe(read.snapshot);
        expect(createNativeRecordingCaptureClock().read(context)).toMatchObject({
            carrier: 'native',
            status: 'available',
        });
    });

    it('keeps issued geometry behind its actual batch and preserves history through unavailable output timestamps', async () => {
        await poll(payload(), 100, 100.004);
        const owner = createNativeRecordingCaptureClock();
        expect(owner.read(context)).toMatchObject({ status: 'available' });
        const edited = {
            ...geometry,
            beatAtSeconds: (seconds: number) => seconds,
            secondsAtBeat: (beat: number) => beat,
        };
        nativeRecordingCaptureClockState.retainAdmission(edited, 9, true);
        await poll(payload(20.2, 20.202), 100.199, 100.204);
        expect(owner.read(context)).toMatchObject({
            status: 'available',
            snapshot: { geometry, admission: { admittedBatch: 7 } },
        });
        await poll({ ...payload(20.3, 20.302), batchesApplied: 9 }, 100.299, 100.304);
        expect(owner.read(context)).toMatchObject({
            status: 'available',
            snapshot: { geometry: edited, admission: { admittedBatch: 9, located: true } },
        });
        const history = owner.last;
        expect(owner.read({ ...context, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) })).toEqual({
            carrier: 'native',
            status: 'unavailable',
        });
        expect(
            owner.read({
                ...context,
                getOutputTimestamp: () => {
                    throw new Error('Output clock unavailable');
                },
            })
        ).toEqual({ carrier: 'native', status: 'unavailable' });
        expect(owner.last).toBe(history);
    });

    it('retains history but requires fresh owner admission after context resume or incompatible calibration', async () => {
        await poll(payload(), 100, 100.004);
        const owner = createNativeRecordingCaptureClock();
        expect(owner.read(context)).toMatchObject({ status: 'available' });
        const history = owner.last;
        expect(owner.read({ ...context, state: 'suspended' })).toEqual({ carrier: 'native', status: 'unavailable' });
        await poll(payload(20.2, 20.202), 100.199, 100.204);
        expect(owner.read(context)).toEqual({ carrier: 'native', status: 'unavailable' });
        expect(owner.last).toBe(history);
        const successor = createNativeRecordingCaptureClock();
        expect(successor.read(context)).toMatchObject({ status: 'available' });
        const retained = successor.last;
        await poll(payload(20.3, 20.302), 101, 101.004);
        expect(successor.read(context)).toEqual({ carrier: 'native', status: 'unavailable' });
        expect(successor.last).toBe(retained);
        await poll(payload(20.4, 20.402), 101.1, 101.104);
        expect(successor.read(context)).toEqual({ carrier: 'native', status: 'unavailable' });
        expect(createNativeRecordingCaptureClock().read(context)).toMatchObject({ status: 'available' });
    });
});
