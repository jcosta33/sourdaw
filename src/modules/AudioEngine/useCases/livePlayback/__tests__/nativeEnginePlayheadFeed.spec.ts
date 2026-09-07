import { beforeEach, describe, expect, it, vi } from 'vitest';

import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { getEngineTransportPosition } from '../../../repositories/engineTransport/getEngineTransportPosition';
import { armNativeLiveAutomationWriter } from '../armNativeLiveAutomationWriter';
import { disarmNativeLiveAutomationWriter } from '../disarmNativeLiveAutomationWriter';
import {
    nativeEnginePlayheadFeed,
    pollNativeEnginePlayheadOnce,
    NATIVE_ENGINE_PLAYHEAD_FEED_ID,
} from '../nativeEnginePlayheadFeedState';
import { nativeLiveAutomationWriter } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { pumpNativeLiveAutomationWriter } from '../pumpNativeLiveAutomationWriter';
import { readNativeEnginePlayheadSeconds } from '../readNativeEnginePlayheadSeconds';
import { rearmNativeLiveAutomationWriterInPlace } from '../rearmNativeLiveAutomationWriterInPlace';
import { requestNativeLiveAutomationWriterRearm } from '../requestNativeLiveAutomationWriterRearm';
import { startNativeEnginePlayheadFeed } from '../startNativeEnginePlayheadFeed';
import { stopNativeEnginePlayheadFeed } from '../stopNativeEnginePlayheadFeed';

vi.mock('../../../repositories/engineTransport/getEngineTransportPosition', () => ({
    getEngineTransportPosition: vi.fn(),
}));
vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: { register: vi.fn(), unregister: vi.fn() },
}));
vi.mock('../pumpNativeLiveAutomationWriter', () => ({
    pumpNativeLiveAutomationWriter: vi.fn(),
}));
vi.mock('../rearmNativeLiveAutomationWriterInPlace', () => ({
    rearmNativeLiveAutomationWriterInPlace: vi.fn(),
}));

const rollingAt = (positionSeconds: number) => ({
    running: true,
    playing: true,
    positionSeconds,
    playheadFrame: positionSeconds * 48_000,
    loopWraps: 0,
    batchesApplied: 0,
    tempo: 120,
    timeSigNum: 4,
    timeSigDenom: 4,
    masterPeak: 0.5,
});

describe('the native engine playhead feed', () => {
    beforeEach(() => {
        stopNativeEnginePlayheadFeed();
        nativeEnginePlayheadFeed.inFlightEpoch = null;
        nativeLiveGraphSession.audibleCarrier = true;
        vi.mocked(animationScheduler.register).mockClear();
        vi.mocked(animationScheduler.unregister).mockClear();
        vi.mocked(getEngineTransportPosition).mockReset();
        vi.mocked(pumpNativeLiveAutomationWriter).mockClear();
        vi.mocked(rearmNativeLiveAutomationWriterInPlace).mockReset();
        nativeLiveAutomationWriter.pendingRearm = null;
        nativeLiveAutomationWriter.pass = null;
        nativeLiveGraphSession.loopRegion = null;
        nativeLiveGraphSession.loopEnabled = false;
    });

    /** The arm a stop-and-play or a locate takes, with nothing to project. */
    function armAnEmptyPass(): void {
        armNativeLiveAutomationWriter({
            stripTracks: [],
            sampleRate: 48_000,
            programmeEndSeconds: 8,
            positionSeconds: 0,
            provenAfterBatch: null,
        });
    }

    it('polls on the animation frame rather than on a timer of its own', () => {
        startNativeEnginePlayheadFeed();

        expect(animationScheduler.register).toHaveBeenCalledWith(
            NATIVE_ENGINE_PLAYHEAD_FEED_ID,
            pollNativeEnginePlayheadOnce
        );
    });

    it('starts once however many times it is started', () => {
        startNativeEnginePlayheadFeed();
        startNativeEnginePlayheadFeed();

        expect(animationScheduler.register).toHaveBeenCalledTimes(1);
    });

    it('reports the position the engine last rendered to', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(3.25));
        startNativeEnginePlayheadFeed();

        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.reading).not.toBeNull());

        expect(readNativeEnginePlayheadSeconds()).toBe(3.25);
    });

    it('drives the automation writer from a settled rolling poll, stamped with the writer epoch the poll captured', async () => {
        // The progress tick is the writer's only steady-state clock: nothing
        // else sends the curve after an arm's own first window.
        let settle = (_reading: ReturnType<typeof rollingAt>): void => undefined;
        const polled = new Promise<ReturnType<typeof rollingAt>>((resolve) => {
            settle = resolve;
        });
        vi.mocked(getEngineTransportPosition).mockReturnValueOnce(polled);
        startNativeEnginePlayheadFeed();

        pollNativeEnginePlayheadOnce();
        const capturedAtPoll = nativeLiveAutomationWriter.epoch;
        // A re-arm lands behind the poll: the reading about to settle belongs
        // to the pass that asked for it, not the one that replaced it.
        nativeLiveAutomationWriter.epoch += 1;

        settle({ ...rollingAt(3.25), loopWraps: 2, batchesApplied: 7 });
        await vi.waitFor(() => expect(vi.mocked(pumpNativeLiveAutomationWriter)).toHaveBeenCalled());

        expect(vi.mocked(pumpNativeLiveAutomationWriter)).toHaveBeenCalledWith({
            positionSeconds: 3.25,
            loopWraps: 2,
            batchesApplied: 7,
            writerEpoch: capturedAtPoll,
        });
    });

    // A plugin the engine took mid-roll is spliced into its chain by a route
    // the pump itself reaches, so the splice states the re-read instead of
    // taking it (#3568). This is where it is taken: on the reading, whose
    // engine position is fresher than anything the splice could have supplied,
    // and before the pump that would otherwise send a pass projected against a
    // chain that had no body for that plugin.
    it('takes the re-read the pass owes before pumping, and pumps the pass it produced', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(3.25));
        vi.mocked(rearmNativeLiveAutomationWriterInPlace).mockImplementation(() => {
            nativeLiveAutomationWriter.pendingRearm = null;
            nativeLiveAutomationWriter.epoch += 1;
        });
        nativeLiveAutomationWriter.pendingRearm = { provenAfterBatch: 42 };
        startNativeEnginePlayheadFeed();

        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(vi.mocked(pumpNativeLiveAutomationWriter)).toHaveBeenCalled());

        expect(vi.mocked(rearmNativeLiveAutomationWriterInPlace)).toHaveBeenCalledWith({
            provenAfterBatch: 42,
            positionSeconds: 3.25,
        });
        // The pump must send the pass the re-arm just produced. Stamped with
        // the epoch captured before it, every write it sends would be discarded
        // as belonging to a pass that had ended.
        expect(vi.mocked(pumpNativeLiveAutomationWriter).mock.calls[0]?.[0].writerEpoch).toBe(
            nativeLiveAutomationWriter.epoch
        );
    });

    it('drops a re-read request that a newer arm already answered', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(3.25));
        startNativeEnginePlayheadFeed();

        pollNativeEnginePlayheadOnce();
        // Between the poll and its answer, a locate re-armed the writer. That
        // arm read the same chain from a position the musician is nearer to, so
        // re-reading again here would throw away a newer pass for an older one.
        nativeLiveAutomationWriter.pendingRearm = { provenAfterBatch: 42 };
        nativeLiveAutomationWriter.epoch += 1;
        await vi.waitFor(() => expect(vi.mocked(pumpNativeLiveAutomationWriter)).toHaveBeenCalled());

        expect(vi.mocked(rearmNativeLiveAutomationWriterInPlace)).not.toHaveBeenCalled();
    });

    /*
     * A re-read is owed by one pass, and the fence it names dates a batch
     * against the engine world that pass ran in. Left standing past the end of
     * that pass, the next session's very first reading takes it — re-arming
     * against a count the new engine scheduler has never reached, which
     * withholds every write until it does.
     */
    it('takes no re-read the pass that owed it did not outlive', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(3.25));
        armAnEmptyPass();
        requestNativeLiveAutomationWriterRearm({ provenAfterBatch: 42 });
        // The transport stops before the reading that would have taken it.
        disarmNativeLiveAutomationWriter();
        vi.mocked(pumpNativeLiveAutomationWriter).mockClear();
        startNativeEnginePlayheadFeed();

        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(vi.mocked(pumpNativeLiveAutomationWriter)).toHaveBeenCalled());

        expect(vi.mocked(rearmNativeLiveAutomationWriterInPlace)).not.toHaveBeenCalled();
    });

    // An arm re-projects the whole world, so it has already answered whatever
    // the request was about; taking it again would throw the arm's own pass
    // away one reading after it opened.
    it('takes no re-read a fresh arm has already answered', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(3.25));
        armAnEmptyPass();
        requestNativeLiveAutomationWriterRearm({ provenAfterBatch: 42 });
        // A locate lands before the next reading does.
        armAnEmptyPass();
        vi.mocked(pumpNativeLiveAutomationWriter).mockClear();
        startNativeEnginePlayheadFeed();

        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(vi.mocked(pumpNativeLiveAutomationWriter)).toHaveBeenCalled());

        expect(vi.mocked(rearmNativeLiveAutomationWriterInPlace)).not.toHaveBeenCalled();
    });

    it('does not stack a second request behind an unanswered one', () => {
        vi.mocked(getEngineTransportPosition).mockReturnValue(new Promise(() => undefined));
        startNativeEnginePlayheadFeed();

        pollNativeEnginePlayheadOnce();
        pollNativeEnginePlayheadOnce();

        // A frame that outlasts the round trip must not queue a reading that
        // will already be superseded when it lands.
        expect(getEngineTransportPosition).toHaveBeenCalledTimes(1);
    });

    it('gives a restarted feed neither the previous run’s reading nor its in-flight slot', async () => {
        let answerTheStalePoll = (): void => undefined;
        const stalePoll = new Promise<ReturnType<typeof rollingAt>>((resolve) => {
            answerTheStalePoll = () => {
                resolve(rollingAt(9));
            };
        });
        vi.mocked(getEngineTransportPosition).mockReturnValueOnce(stalePoll);

        startNativeEnginePlayheadFeed();
        pollNativeEnginePlayheadOnce();
        stopNativeEnginePlayheadFeed();
        startNativeEnginePlayheadFeed();

        // The stop and the restart both happened inside the first round trip.
        // Its answer belongs to the run that asked for it, which is over.
        answerTheStalePoll();
        await stalePoll;
        expect(nativeEnginePlayheadFeed.reading).toBeNull();
        expect(readNativeEnginePlayheadSeconds()).toBeNull();

        // And the new run's first frame must reach the engine: an in-flight
        // slot the previous run left claimed would swallow it silently.
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(1.5));
        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.reading).not.toBeNull());

        expect(getEngineTransportPosition).toHaveBeenCalledTimes(2);
        expect(readNativeEnginePlayheadSeconds()).toBe(1.5);
    });

    it('does not let a stale settlement release the claim a newer run already holds', async () => {
        const deferred = () => {
            let settle = (_reading: ReturnType<typeof rollingAt>): void => undefined;
            const promise = new Promise<ReturnType<typeof rollingAt>>((resolve) => {
                settle = resolve;
            });
            return { promise, settle: (reading: ReturnType<typeof rollingAt>) => settle(reading) };
        };
        const stale = deferred();
        const current = deferred();
        vi.mocked(getEngineTransportPosition)
            .mockReturnValueOnce(stale.promise)
            .mockReturnValueOnce(current.promise)
            // Any further request is a real promise, so a third poll shows up
            // as a call count rather than as a crash on an undefined result.
            .mockResolvedValue(rollingAt(99));

        startNativeEnginePlayheadFeed();
        pollNativeEnginePlayheadOnce();
        stopNativeEnginePlayheadFeed();
        startNativeEnginePlayheadFeed();
        // The new run's request is already out when the old one answers, which
        // is the ordering an unconditional release gets wrong.
        pollNativeEnginePlayheadOnce();

        stale.settle(rollingAt(9));
        // A macrotask, not `await stale.promise`: the stale chain's own
        // `finally` is queued behind its `then`, so a microtask that only
        // awaits the base promise runs before the release this asserts about.
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Releasing the slot here would release a claim this run still holds,
        // and the next frame would stack a second request behind its own.
        pollNativeEnginePlayheadOnce();
        expect(getEngineTransportPosition).toHaveBeenCalledTimes(2);

        current.settle(rollingAt(1.5));
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.reading).not.toBeNull());
        expect(readNativeEnginePlayheadSeconds()).toBe(1.5);
    });

    it('refuses to answer while the session is not the audible carrier', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(3.25));
        startNativeEnginePlayheadFeed();
        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.reading).not.toBeNull());

        nativeLiveGraphSession.audibleCarrier = false;

        // The engine is running and rolling, but it is not what a musician
        // hears; a cursor drawn from it would leave the mix.
        expect(readNativeEnginePlayheadSeconds()).toBeNull();
    });

    it('refuses to answer for an engine that is parked', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue({ ...rollingAt(3.25), playing: false });
        startNativeEnginePlayheadFeed();
        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.reading).not.toBeNull());

        expect(readNativeEnginePlayheadSeconds()).toBeNull();
    });

    it('forgets the last reading when it stops, and unregisters the frame callback', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(3.25));
        startNativeEnginePlayheadFeed();
        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.reading).not.toBeNull());

        stopNativeEnginePlayheadFeed();

        expect(animationScheduler.unregister).toHaveBeenCalledWith(NATIVE_ENGINE_PLAYHEAD_FEED_ID);
        expect(readNativeEnginePlayheadSeconds()).toBeNull();
    });
});
