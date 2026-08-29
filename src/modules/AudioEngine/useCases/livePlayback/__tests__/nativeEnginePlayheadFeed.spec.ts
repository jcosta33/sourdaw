import { beforeEach, describe, expect, it, vi } from 'vitest';

import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { getEngineTransportPosition } from '../../../repositories/engineTransport/getEngineTransportPosition';
import {
    nativeEnginePlayheadFeed,
    pollNativeEnginePlayheadOnce,
    NATIVE_ENGINE_PLAYHEAD_FEED_ID,
} from '../nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { readNativeEnginePlayheadSeconds } from '../readNativeEnginePlayheadSeconds';
import { startNativeEnginePlayheadFeed } from '../startNativeEnginePlayheadFeed';
import { stopNativeEnginePlayheadFeed } from '../stopNativeEnginePlayheadFeed';

vi.mock('../../../repositories/engineTransport/getEngineTransportPosition', () => ({
    getEngineTransportPosition: vi.fn(),
}));
vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: { register: vi.fn(), unregister: vi.fn() },
}));

const rollingAt = (positionSeconds: number) => ({
    running: true,
    playing: true,
    positionSeconds,
    playheadFrame: positionSeconds * 48_000,
    loopWraps: 0,
    tempo: 120,
    timeSigNum: 4,
    timeSigDenom: 4,
});

describe('the native engine playhead feed', () => {
    beforeEach(() => {
        stopNativeEnginePlayheadFeed();
        nativeEnginePlayheadFeed.inFlightEpoch = null;
        nativeLiveGraphSession.carriesAudio = true;
        vi.mocked(animationScheduler.register).mockClear();
        vi.mocked(animationScheduler.unregister).mockClear();
        vi.mocked(getEngineTransportPosition).mockReset();
    });

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

    it('refuses to answer while the session topology carries no audio', async () => {
        vi.mocked(getEngineTransportPosition).mockResolvedValue(rollingAt(3.25));
        startNativeEnginePlayheadFeed();
        pollNativeEnginePlayheadOnce();
        await vi.waitFor(() => expect(nativeEnginePlayheadFeed.reading).not.toBeNull());

        nativeLiveGraphSession.carriesAudio = false;

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
