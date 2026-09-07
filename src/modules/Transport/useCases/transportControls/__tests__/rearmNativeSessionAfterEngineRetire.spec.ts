/**
 * What the transport does with a re-arm offer from a retired native engine
 * (#3960).
 *
 * The offer arrives on `nativeEngineRearmStore`, doubled here by a real store
 * built from the same `createStore` the module uses — the AudioEngine store
 * barrel itself is not worth standing up for one field. `ensureTrackStrips`
 * and the native start are doubled because what is under test is the decision
 * between them: whether a start is fired at all, at what beat, and how many
 * times per play.
 *
 * The one-re-arm guard is doubled with the same semantics the real
 * `claimNativeSessionRearm` has (proven in its own spec), so the loop-guard
 * case below observes the subscriber's use of it rather than the flag.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { nativeEngineRearmStore } from '#/modules/AudioEngine/stores';
import { startNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { ensureTrackStrips } from '../../ensureTrackStrips';
import { rearmNativeSessionAfterEngineRetire } from '../rearmNativeSessionAfterEngineRetire';

import type { EnsureTrackStripsResult } from '../../ensureTrackStrips';

const mocks = vi.hoisted(() => ({
    /**
     * The real guard's contract: an epoch once per play, `null` after that,
     * and a controllable `holds` answer standing in for `nativeSessionRearmClaimHolds`
     * so a case can simulate a stop invalidating the claim mid-reload.
     */
    rearm: { claimed: false, epoch: 0, holds: true },
}));

vi.mock('#/modules/AudioEngine/stores', async () => {
    const { createStore } = await import('#/infra/store/createStore');
    return { nativeEngineRearmStore: createStore<{ offers: number }>({ initialData: { offers: 0 } }) };
});
vi.mock('#/modules/AudioEngine/useCases', () => ({
    claimNativeSessionRearm: (): number | null => {
        if (mocks.rearm.claimed) {
            return null;
        }
        mocks.rearm.claimed = true;
        return mocks.rearm.epoch;
    },
    nativeSessionRearmClaimHolds: (): boolean => mocks.rearm.holds,
    startNativeLiveGraphSession: vi.fn(),
    getAudioContext: (): { sampleRate: number } => ({ sampleRate: 48_000 }),
}));
vi.mock('../../../repositories/transport/getTransportState', () => ({ getTransportState: vi.fn() }));
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: vi.fn() }));

function offerRearm(): void {
    nativeEngineRearmStore.update((state) => ({ offers: (state?.offers ?? 0) + 1 }));
}

type ExternalPluginActivation = Extract<
    EnsureTrackStripsResult,
    { status: 'ready' }
>['externalPluginActivations'][number];

function readyStrips(activations: readonly ExternalPluginActivation[]): EnsureTrackStripsResult {
    return { status: 'ready', externalPluginActivations: [...activations] };
}

/** Let the subscriber's queued work run without waiting on a timer. */
async function flushMicrotasks(): Promise<void> {
    for (let pass = 0; pass < 5; pass += 1) {
        await Promise.resolve();
    }
}

describe('rearmNativeSessionAfterEngineRetire', () => {
    let unsubscribe: () => void = () => {};

    beforeEach(() => {
        unsubscribe();
        vi.mocked(getTransportState).mockReset();
        vi.mocked(ensureTrackStrips).mockReset();
        vi.mocked(ensureTrackStrips).mockReturnValue(readyStrips([]));
        vi.mocked(startNativeLiveGraphSession).mockReset();
        vi.mocked(startNativeLiveGraphSession).mockResolvedValue({ outcome: 'declined', reason: 'no desktop bridge' });
        mocks.rearm.claimed = false;
        mocks.rearm.epoch = 0;
        mocks.rearm.holds = true;
        playheadPositionRef.current = 0;
        nativeEngineRearmStore.set({ offers: 0 });
        unsubscribe = rearmNativeSessionAfterEngineRetire();
    });

    it('rebuilds the strips and restarts the session at the live playhead', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        playheadPositionRef.current = 8;

        offerRearm();

        await vi.waitFor(() => expect(startNativeLiveGraphSession).toHaveBeenCalledTimes(1));
        expect(ensureTrackStrips).toHaveBeenCalledWith({ collectExternalPluginActivations: true });
        // Beat 8 at 120 BPM is four seconds in: the beat is read at the start,
        // not at the offer, so the engine opens where the transport actually is.
        expect(startNativeLiveGraphSession).toHaveBeenCalledWith(expect.objectContaining({ positionSeconds: 4 }));
    });

    it('waits for the forgotten plugins to reload before it starts the session', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        let settleActivation = (): void => undefined;
        const activation = new Promise<{ status: 'active' }>((resolve) => {
            settleActivation = () => resolve({ status: 'active' });
        });
        vi.mocked(ensureTrackStrips).mockReturnValue(readyStrips([activation]));

        offerRearm();
        await flushMicrotasks();

        // A batch sent now would attach none of the instances the retire
        // destroyed, and no later batch reloads them.
        expect(startNativeLiveGraphSession).not.toHaveBeenCalled();

        settleActivation();

        await vi.waitFor(() => expect(startNativeLiveGraphSession).toHaveBeenCalledTimes(1));
    });

    it('leaves the engine down when the play ends and stays ended during the reload', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        let settleActivation = (): void => undefined;
        const activation = new Promise<{ status: 'active' }>((resolve) => {
            settleActivation = () => resolve({ status: 'active' });
        });
        vi.mocked(ensureTrackStrips).mockReturnValue(readyStrips([activation]));

        offerRearm();
        await flushMicrotasks();

        // The Stop lands while the reload is still in the air: it invalidates
        // the claim, exactly as the real stop bumping the epoch would.
        mocks.rearm.holds = false;
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: false, tempo: 120 });
        settleActivation();
        await flushMicrotasks();

        expect(startNativeLiveGraphSession).not.toHaveBeenCalled();
    });

    it("leaves a new play's session alone when the claiming play stopped during the reload", async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        let settleActivation = (): void => undefined;
        const activation = new Promise<{ status: 'active' }>((resolve) => {
            settleActivation = () => resolve({ status: 'active' });
        });
        vi.mocked(ensureTrackStrips).mockReturnValue(readyStrips([activation]));

        offerRearm();
        await flushMicrotasks();

        // A stop landed inside the reload, invalidating this claim, and a new
        // play started before the reload settled: the shared isPlaying flag
        // reads true again, but it now belongs to the new play's own session.
        mocks.rearm.holds = false;
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        settleActivation();
        await flushMicrotasks();

        expect(startNativeLiveGraphSession).not.toHaveBeenCalled();
    });

    it('starts at the tempo the transport holds when the reload settles', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        playheadPositionRef.current = 30;
        let settleActivation = (): void => undefined;
        const activation = new Promise<{ status: 'active' }>((resolve) => {
            settleActivation = () => resolve({ status: 'active' });
        });
        vi.mocked(ensureTrackStrips).mockReturnValue(readyStrips([activation]));

        offerRearm();
        await flushMicrotasks();

        // A tempo edit landed while the reload was in the air. There is no
        // tempo map here, so positionSeconds must integrate at the tempo the
        // transport holds now (60 BPM), not the 120 BPM captured at the offer:
        // beat 30 at 60 BPM is 30 seconds in.
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 60 });
        settleActivation();

        await vi.waitFor(() => expect(startNativeLiveGraphSession).toHaveBeenCalledTimes(1));
        expect(startNativeLiveGraphSession).toHaveBeenCalledWith(expect.objectContaining({ positionSeconds: 30 }));
    });

    it('re-arms once per play, however many engines the same play loses', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 120 });

        offerRearm();
        await vi.waitFor(() => expect(startNativeLiveGraphSession).toHaveBeenCalledTimes(1));

        offerRearm();
        await flushMicrotasks();

        // A re-armed session that dies again would otherwise cycle the renderer
        // through restarts for as long as the device keeps flapping.
        expect(ensureTrackStrips).toHaveBeenCalledTimes(1);
        expect(startNativeLiveGraphSession).toHaveBeenCalledTimes(1);
    });

    it('leaves a stopped transport alone, and keeps its re-arm unspent', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: false, tempo: 120 });

        offerRearm();
        await flushMicrotasks();

        expect(ensureTrackStrips).not.toHaveBeenCalled();
        expect(startNativeLiveGraphSession).not.toHaveBeenCalled();
        // The next play boots its own engine, so this offer must not have spent
        // the guard that play will need.
        expect(mocks.rearm.claimed).toBe(false);
    });

    it('does not start a session on strips it could not rebuild', async () => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        vi.mocked(ensureTrackStrips).mockReturnValue({ status: 'failed', reason: 'Project tracks are unavailable' });

        offerRearm();
        await flushMicrotasks();

        expect(ensureTrackStrips).toHaveBeenCalledTimes(1);
        expect(startNativeLiveGraphSession).not.toHaveBeenCalled();
    });
});
