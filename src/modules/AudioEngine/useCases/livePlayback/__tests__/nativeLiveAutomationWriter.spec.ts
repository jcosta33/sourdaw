/**
 * What the live automation writer sends the engine, and when (#3068, D3.c.4b).
 *
 * The double is `readLiveAutomationWrites`, the one place the producer binds to
 * the stores. Its own laws — the fader decibel law, the VCA fold, the send
 * clamp, the region clip — are proven where they live
 * (`projectLiveAutomationWrites.spec.ts`, and end to end against the export in
 * `renderOfflineNativeParity.spec.ts`). What is proven here is everything
 * downstream of the curve: which writes leave on which tick, what a refusal
 * costs, and what a seam, a locate and a stop do to the cursor.
 *
 * The double is region-aware, because the region *is* half of what a re-arm
 * changes: a producer that answered the same curve whatever region it was
 * handed would make a locate indistinguishable from a no-op.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
    type AudioGraphParameterWrite,
    type AudioGraphStripParameterTarget,
    type AudioGraphWriteParameterCommand,
} from '../../../models/AudioGraphBackend';
import { armNativeLiveAutomationWriter } from '../armNativeLiveAutomationWriter';
import { nativeLiveAutomationWriter } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { pumpNativeLiveAutomationWriter } from '../pumpNativeLiveAutomationWriter';
import { repositionNativeLiveGraphSession } from '../repositionNativeLiveGraphSession';
import { stopNativeLiveGraphSession } from '../stopNativeLiveGraphSession';

const mocks = vi.hoisted(() => ({
    /** The whole curve, before the region clip the producer applies. */
    curve: [] as { target: unknown; writes: unknown[] }[],
    apply: vi.fn<(batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult>>(),
    stopPlayheadFeed: vi.fn(),
    warn: vi.fn<(message: string, ...rest: unknown[]) => void>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../stopNativeEnginePlayheadFeed', () => ({
    stopNativeEnginePlayheadFeed: () => mocks.stopPlayheadFeed(),
}));
vi.mock('../readLiveAutomationWrites', () => ({
    readLiveAutomationWrites: (input: { regionStartSeconds: number; regionEndSeconds: number }) => ({
        entries: mocks.curve
            .map((entry) => ({
                target: entry.target as AudioGraphStripParameterTarget,
                writes: (entry.writes as AudioGraphParameterWrite[]).filter((write) => {
                    const at = write.shape === 'ramp-to' ? write.startTime : write.time;
                    return at >= input.regionStartSeconds && at < input.regionEndSeconds;
                }),
            }))
            .filter((entry) => entry.writes.length > 0),
        exclusions: [],
    }),
}));

const FADER: AudioGraphStripParameterTarget = { kind: 'track-fader', trackId: 'track-a' };
const PAN: AudioGraphStripParameterTarget = { kind: 'track-pan', trackId: 'track-a' };

const APPLIED: AudioGraphApplyResult = {
    acceptance: 'accepted',
    application: 'applied',
    runtimeRevision: 1,
    reports: [],
};

/** The engine's own refusal when a parameter's eight-slot queue is full. */
const QUEUE_FULL: AudioGraphApplyResult = {
    acceptance: 'rejected',
    application: 'not-applied',
    reason: 'automation-queue-capacity — this parameter’s native queue is full',
};

const backend: AudioGraphBackend = {
    backendId: 'writer-spec',
    apply: (batch) => mocks.apply(batch),
    dispose: () => undefined,
};

function step(time: number, value: number): AudioGraphParameterWrite {
    return { shape: 'step', value, time };
}

function ramp(startTime: number, landTime: number, value: number): AudioGraphParameterWrite {
    return { shape: 'ramp-to', value, startTime, landTime };
}

/** Every batch that carried automation, as its write-parameter commands. */
function writeBatches(): AudioGraphWriteParameterCommand[][] {
    return mocks.apply.mock.calls
        .map(([batch]) =>
            batch.commands.filter(
                (command): command is AudioGraphWriteParameterCommand => command.kind === 'write-parameter'
            )
        )
        .filter((commands) => commands.length > 0);
}

/** The writes of the batch at `index`, in the order they were sent. */
function writesOf(index: number): AudioGraphParameterWrite[] {
    return (writeBatches()[index] ?? []).map((command) => command.write);
}

/**
 * A macrotask, which drains the whole microtask queue: the pump queues on the
 * session's command chain and settles its cursor a turn behind that.
 */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function arm(positionSeconds: number): void {
    armNativeLiveAutomationWriter({
        stripTracks: [],
        sampleRate: 48_000,
        programmeEndSeconds: 8,
        positionSeconds,
    });
}

async function pump(positionSeconds: number, loopWraps: number): Promise<void> {
    await pumpNativeLiveAutomationWriter({ positionSeconds, loopWraps });
    await flush();
}

/** An apply the spec settles by hand, so a round trip can be held open. */
function deferApply(): { settle: (result: AudioGraphApplyResult) => void } {
    let settle: (result: AudioGraphApplyResult) => void = () => undefined;
    mocks.apply.mockImplementationOnce(
        () =>
            new Promise<AudioGraphApplyResult>((resolve) => {
                settle = resolve;
            })
    );
    return { settle: (result) => settle(result) };
}

beforeEach(() => {
    mocks.apply.mockReset();
    mocks.apply.mockResolvedValue(APPLIED);
    mocks.stopPlayheadFeed.mockClear();
    mocks.warn.mockClear();
    mocks.curve = [];
    nativeLiveAutomationWriter.epoch += 1;
    nativeLiveAutomationWriter.inFlightEpoch = null;
    nativeLiveAutomationWriter.pass = null;
    nativeLiveGraphSession.backend = backend;
    nativeLiveGraphSession.rolling = true;
    nativeLiveGraphSession.loopRegion = null;
    nativeLiveGraphSession.loopEnabled = false;
    nativeLiveGraphSession.pending = Promise.resolve();
});

describe('the live automation writer', () => {
    it('admits a ramp on its start and sends it whole, however far past the window it lands', async () => {
        mocks.curve = [{ target: FADER, writes: [ramp(0.05, 0.5, 0.4)] }];

        arm(0);
        await flush();

        // Splitting it is not available: the engine re-anchors the trajectory
        // at the value the parameter holds on the start frame, so half a ramp
        // is a different ramp, not the first half of this one.
        expect(writesOf(0)).toEqual([ramp(0.05, 0.5, 0.4)]);
    });

    it('re-sends the region from the loop start once the engine reports the seam closed', async () => {
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 2, endSeconds: 4 };
        nativeLiveGraphSession.loopEnabled = true;
        mocks.curve = [
            {
                target: FADER,
                // The last one is still gliding at the loop end: the wrap would
                // cancel it mid-flight, so it never goes out at all.
                writes: [step(2, 0.9), step(2.05, 0.8), step(3, 0.6), ramp(3.9, 4.5, 0.2)],
            },
        ];

        arm(2);
        await flush();
        await pump(2.5, 0);
        await pump(2.95, 0);
        // The playhead is back near the loop start and the engine has counted
        // the seam. Everything the first pass walked past left its queue.
        await pump(2.01, 1);

        expect(writesOf(0)).toEqual([step(2, 0.9), step(2.05, 0.8)]);
        expect(writesOf(1)).toEqual([step(3, 0.6)]);
        expect(writesOf(2)).toEqual([step(2, 0.9), step(2.05, 0.8)]);
        const everyWrite = writeBatches().flatMap((commands) => commands.map((command) => command.write));
        expect(everyWrite.some((write) => write.shape === 'ramp-to')).toBe(false);
    });

    it('writes nothing across a locate until the engine applies it, then replays from the new position', async () => {
        mocks.curve = [{ target: FADER, writes: [step(0, 0.9), step(0.05, 0.8), step(0.5, 0.6), step(0.55, 0.5)] }];

        arm(0);
        await flush();
        expect(writeBatches()).toHaveLength(1);

        const locate = deferApply();
        void repositionNativeLiveGraphSession({ positionSeconds: 0.5 });
        await flush();

        // A tick lands while the locate is still out. Its writes describe a
        // region the engine is being moved out of, and the seek is what drops
        // whatever is queued at or past its target.
        void pumpNativeLiveAutomationWriter({ positionSeconds: 0.5, loopWraps: 0 });
        await flush();
        expect(writeBatches()).toHaveLength(1);

        locate.settle(APPLIED);
        await flush();

        // Exactly one: the tick issued against the pass the locate ended owns
        // nothing, so the re-armed pass is the only thing that wrote.
        expect(writeBatches()).toHaveLength(2);
        expect(nativeLiveAutomationWriter.pass?.regionStartSeconds).toBe(0.5);
        expect(writesOf(1)).toEqual([step(0.5, 0.6), step(0.55, 0.5)]);
    });

    it('fills one target to its budget, and re-offers a refused batch unchanged', async () => {
        mocks.curve = [
            {
                target: FADER,
                writes: [
                    step(0, 0.1),
                    step(0.01, 0.2),
                    step(0.02, 0.3),
                    step(0.03, 0.4),
                    step(0.04, 0.5),
                    step(0.05, 0.6),
                    step(0.06, 0.7),
                    step(0.07, 0.8),
                ],
            },
        ];

        arm(0);
        await flush();

        // Six of the engine's eight slots, so the two an earlier pump may still
        // hold cannot make an ordinary tick refuse.
        expect(writesOf(0)).toHaveLength(6);
        expect(nativeLiveAutomationWriter.pass?.targets[0]?.cursor).toBe(6);

        mocks.apply.mockResolvedValueOnce(QUEUE_FULL);
        await pump(0, 0);

        // A refusal is whole-batch, before anything is pushed: the cursor is a
        // claim that the engine took those writes, and it took none of them.
        expect(nativeLiveAutomationWriter.pass?.targets[0]?.cursor).toBe(6);

        await pump(0, 0);
        expect(writesOf(1)).toEqual([step(0.06, 0.7), step(0.07, 0.8)]);
        expect(writesOf(2)).toEqual([step(0.06, 0.7), step(0.07, 0.8)]);
        expect(nativeLiveAutomationWriter.pass?.targets[0]?.cursor).toBe(8);
    });

    it('writes nothing once the transport stopped, whatever tick arrives late', async () => {
        mocks.curve = [
            { target: FADER, writes: [step(0, 0.9), step(0.5, 0.6)] },
            { target: PAN, writes: [step(0.5, 0.2)] },
        ];

        arm(0);
        await flush();
        expect(writeBatches()).toHaveLength(1);

        await stopNativeLiveGraphSession({ positionSeconds: 0.4 });
        await flush();

        // The engine's own park holds every mixer parameter where it stands;
        // what must not happen is this side pushing more curve onto a transport
        // that is no longer moving.
        expect(nativeLiveAutomationWriter.pass).toBeNull();
        await pump(0.5, 0);
        expect(writeBatches()).toHaveLength(1);
    });
});
