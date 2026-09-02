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
 * handed would make a locate indistinguishable from a no-op. It also emits the
 * leading `set` the real compiler emits at every region start
 * (`compileAutomationEvents.ts`), because the value a pass opens on is exactly
 * what a span starting at the playhead is for.
 *
 * `engineQueueBackend` is the other half of the instrument: a backend that runs
 * the control-side ledger from `crates/sourdaw-native/src/commands/graph.rs`
 * and refuses what the real one refuses. A window law that only ever meets an
 * accepting backend is not measured at all.
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
import { type EngineTransportPosition } from '../../../models/EngineTransportPosition';
import { armNativeLiveAutomationWriter } from '../armNativeLiveAutomationWriter';
import { disarmNativeLiveAutomationWriter } from '../disarmNativeLiveAutomationWriter';
import { nativeEnginePlayheadFeed, pollNativeEnginePlayheadOnce } from '../nativeEnginePlayheadFeedState';
import { AUTOMATION_QUEUE_CAPACITY, nativeLiveAutomationWriter } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { pumpNativeLiveAutomationWriter } from '../pumpNativeLiveAutomationWriter';
import { repositionNativeLiveGraphSession } from '../repositionNativeLiveGraphSession';
import { stopNativeLiveGraphSession } from '../stopNativeLiveGraphSession';

const SAMPLE_RATE = 48_000;
const FRAME = 1 / SAMPLE_RATE;

const mocks = vi.hoisted(() => ({
    /** The whole curve, before the region clip the producer applies. */
    curve: [] as { target: unknown; writes: unknown[]; opensAt?: unknown }[],
    /** What every arm's producer reports it could not carry. */
    exclusions: [] as { stripId: string; subjectId: string; reason: string }[],
    apply: vi.fn<(batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult>>(),
    readPosition: vi.fn<() => Promise<EngineTransportPosition>>(),
    stopPlayheadFeed: vi.fn(),
    warn: vi.fn<(message: string, ...rest: unknown[]) => void>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../stopNativeEnginePlayheadFeed', () => ({
    stopNativeEnginePlayheadFeed: () => mocks.stopPlayheadFeed(),
}));
vi.mock('../../../repositories/engineTransport/getEngineTransportPosition', () => ({
    getEngineTransportPosition: () => mocks.readPosition(),
}));
vi.mock('../readLiveAutomationWrites', () => ({
    readLiveAutomationWrites: (input: { regionStartSeconds: number; regionEndSeconds: number }) => ({
        entries: mocks.curve
            .map((entry) => {
                const inside = (entry.writes as AudioGraphParameterWrite[]).filter((write) => {
                    const at = write.shape === 'ramp-to' ? write.startTime : write.time;
                    // The producer's own clip is end-inclusive: a step landing
                    // exactly on the window end is emitted
                    // (`compileAutomationEvents`), so the double must hand one
                    // through too — which is exactly the write the seam clip
                    // answers for.
                    return at >= input.regionStartSeconds && at <= input.regionEndSeconds;
                });
                // The compiler's leading `set`: whatever else a span carries, it
                // opens by establishing the value the lane holds where it starts.
                const opensAt = entry.opensAt as number | undefined;
                const opening =
                    opensAt === undefined
                        ? []
                        : [{ shape: 'step' as const, value: opensAt, time: input.regionStartSeconds }];
                return { target: entry.target as AudioGraphStripParameterTarget, writes: [...opening, ...inside] };
            })
            .filter((entry) => entry.writes.length > 0),
        exclusions: mocks.exclusions,
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

/**
 * A curved lane, as `compileAutomationEvents` compiles one: a linear segment
 * per 10 ms grid step, each anchored one frame after its predecessor landed.
 * That one frame is why the segments do not cancel each other in the engine's
 * queue, and so why ten of them fit inside one lookahead.
 */
function curvedLane(count: number): AudioGraphParameterWrite[] {
    return Array.from({ length: count }, (_unused, index) =>
        ramp(index * 0.01 + FRAME, (index + 1) * 0.01, 0.2 + index * 0.05)
    );
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

function arm(positionSeconds: number, provenAfterBatch: number | null = null): void {
    armNativeLiveAutomationWriter({
        stripTracks: [],
        sampleRate: SAMPLE_RATE,
        programmeEndSeconds: 8,
        positionSeconds,
        provenAfterBatch,
    });
}

async function pump(positionSeconds: number, loopWraps: number, batchesApplied: number | null = null): Promise<void> {
    await pumpNativeLiveAutomationWriter({
        positionSeconds,
        loopWraps,
        batchesApplied,
        writerEpoch: nativeLiveAutomationWriter.epoch,
    });
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

type QueuedStamp = { startFrame: number; landFrame: number };

/**
 * The engine's ledger, on this side of the wire: `QueueBudgets` from
 * `graph.rs`. A stamp releases when the echoed playhead has passed its start
 * frame (`proven_popped`), a write that is not a step first drops every stamp
 * landing at or after its own start (`RampedParam::cancel_stale`), and a batch
 * that would take a parameter past the capacity refuses whole.
 */
function engineQueueBackend(): { apply: (batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult> } {
    const queues = new Map<string, QueuedStamp[]>();
    return {
        apply: (batch) => {
            const echoFrame = Math.round(engineEchoSeconds * SAMPLE_RATE);
            for (const [key, stamps] of queues) {
                queues.set(
                    key,
                    stamps.filter((stamp) => stamp.startFrame >= echoFrame)
                );
            }
            const charged = new Map([...queues].map(([key, stamps]): [string, QueuedStamp[]] => [key, [...stamps]]));
            for (const command of batch.commands) {
                if (command.kind !== 'write-parameter') {
                    continue;
                }
                const { target, write } = command;
                const key =
                    target.kind === 'track-send-level'
                        ? `${target.kind}:${target.trackId}:${target.busId}`
                        : `${target.kind}:${target.trackId}`;
                const startFrame = Math.round((write.shape === 'ramp-to' ? write.startTime : write.time) * SAMPLE_RATE);
                const landFrame = Math.round((write.shape === 'ramp-to' ? write.landTime : write.time) * SAMPLE_RATE);
                const queued = charged.get(key) ?? [];
                const surviving = write.shape === 'step' ? queued : queued.filter((s) => s.landFrame < startFrame);
                if (surviving.length === AUTOMATION_QUEUE_CAPACITY) {
                    return Promise.resolve(QUEUE_FULL);
                }
                charged.set(key, [...surviving, { startFrame, landFrame }]);
            }
            for (const [key, stamps] of charged) {
                queues.set(key, stamps);
            }
            return Promise.resolve(APPLIED);
        },
    };
}

/** What the engine's progress echo would report to the ledger fake. */
let engineEchoSeconds = 0;

beforeEach(() => {
    mocks.apply.mockReset();
    mocks.apply.mockResolvedValue(APPLIED);
    mocks.readPosition.mockReset();
    mocks.stopPlayheadFeed.mockClear();
    mocks.warn.mockClear();
    mocks.curve = [];
    mocks.exclusions = [];
    engineEchoSeconds = 0;
    nativeLiveAutomationWriter.epoch += 1;
    nativeLiveAutomationWriter.inFlightEpoch = null;
    nativeLiveAutomationWriter.pass = null;
    nativeLiveAutomationWriter.reportedExclusions = null;
    nativeEnginePlayheadFeed.running = false;
    nativeEnginePlayheadFeed.epoch += 1;
    nativeEnginePlayheadFeed.inFlightEpoch = null;
    nativeEnginePlayheadFeed.reading = null;
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

    it('opens a looping pass at the playhead, and takes the whole region only once a seam closes', async () => {
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 2, endSeconds: 4 };
        nativeLiveGraphSession.loopEnabled = true;
        mocks.curve = [
            {
                target: FADER,
                opensAt: 0.55,
                // The last one is still gliding at the loop end: the wrap would
                // cancel it mid-flight, so it never goes out at all.
                writes: [step(2, 0.9), step(2.05, 0.8), step(3.6, 0.6), ramp(3.9, 4.5, 0.2)],
            },
        ];

        arm(3.5);
        await flush();

        // The playhead is at 3.5. Everything behind it belongs to a pass that
        // already happened: replaying it would not replay the past, it would
        // resolve the whole of it inside one block and sweep the fader through
        // it. So the take opens on the value the lane holds at 3.5, and nothing
        // else until the curve reaches the playhead.
        expect(writesOf(0)).toEqual([step(3.5, 0.55)]);

        await pump(3.55, 0);
        expect(writesOf(1)).toEqual([step(3.6, 0.6)]);

        // The seam. Now the engine really is walking the region from its start,
        // so the region entire is what the next pass owes.
        engineEchoSeconds = 2;
        await pump(2.01, 1);
        expect(writesOf(2)).toEqual([step(2, 0.55), step(2, 0.9), step(2.05, 0.8)]);

        const everyWrite = writeBatches().flatMap((commands) => commands.map((command) => command.write));
        expect(everyWrite.some((write) => write.shape === 'ramp-to')).toBe(false);
    });

    it('runs to the programme end without looping when play begins at or past the loop end', async () => {
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 2, endSeconds: 4 };
        nativeLiveGraphSession.loopEnabled = true;
        mocks.curve = [{ target: FADER, opensAt: 0.3, writes: [step(3, 0.9), step(5, 0.7)] }];

        arm(4.5);
        await flush();
        await pump(4.95, 0);

        // `Scheduler::frames_until_loop_end` never wraps a playhead already at
        // or past the region's end, so this take is an ordinary one to the end
        // of the programme — and the region's own curve is behind it.
        expect(nativeLiveAutomationWriter.pass?.looping).toBe(false);
        expect(nativeLiveAutomationWriter.pass?.loopTargets).toBeNull();
        expect(writesOf(0)).toEqual([step(4.5, 0.3)]);
        expect(writesOf(1)).toEqual([step(5, 0.7)]);
    });

    it('covers the stretch before the loop start when play begins outside the region', async () => {
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 2, endSeconds: 4 };
        nativeLiveGraphSession.loopEnabled = true;
        mocks.curve = [{ target: FADER, opensAt: 0.3, writes: [step(0.5, 0.9), step(2.5, 0.7)] }];

        arm(0);
        await flush();
        await pump(0.45, 0);

        // The engine plays 0 to the loop end before it wraps, so that whole
        // stretch is this pass's, not just the part inside the region.
        expect(writesOf(0)).toEqual([step(0, 0.3)]);
        expect(writesOf(1)).toEqual([step(0.5, 0.9)]);
        expect(nativeLiveAutomationWriter.pass?.looping).toBe(true);
    });

    it('takes a seam the engine closed before this pass read a single snapshot', async () => {
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 2, endSeconds: 4 };
        nativeLiveGraphSession.loopEnabled = true;
        mocks.curve = [{ target: FADER, opensAt: 0.55, writes: [step(2, 0.9), step(2.05, 0.8)] }];

        // Locate to just under the loop end. The engine wraps before the feed
        // reads it even once, so the first snapshot this pass ever sees already
        // carries a wrap count it has nothing to compare against.
        arm(3.95);
        await flush();
        expect(writesOf(0)).toEqual([step(3.95, 0.55)]);

        engineEchoSeconds = 2;
        await pump(2.0, 7);

        // A position behind where the pass began can only be the engine taking
        // the musician back to the loop start.
        expect(writesOf(1)).toEqual([step(2, 0.55), step(2, 0.9), step(2.05, 0.8)]);
    });

    it('spans the playhead to the programme end when a loop region is installed but not enabled', async () => {
        // The engine's own answer, not the request: a region under its floor is
        // held and never wrapped, and a pass written for it would wait at a
        // seam that never arrives.
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 2, endSeconds: 4 };
        nativeLiveGraphSession.loopEnabled = false;
        mocks.curve = [{ target: FADER, opensAt: 0.3, writes: [step(2.5, 0.9), step(6, 0.7)] }];

        arm(1);
        await flush();

        expect(nativeLiveAutomationWriter.pass?.looping).toBe(false);
        expect(nativeLiveAutomationWriter.pass?.entrySeconds).toBe(1);
        expect(writesOf(0)).toEqual([step(1, 0.3)]);

        await pump(2.45, 0);
        expect(writesOf(1)).toEqual([step(2.5, 0.9)]);

        await pump(5.95, 0);
        expect(writesOf(2)).toEqual([step(6, 0.7)]);
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
        void pumpNativeLiveAutomationWriter({
            positionSeconds: 0.5,
            loopWraps: 0,
            batchesApplied: null,
            writerEpoch: nativeLiveAutomationWriter.epoch,
        });
        await flush();
        expect(writeBatches()).toHaveLength(1);

        locate.settle(APPLIED);
        await flush();

        // Exactly one: the tick issued against the pass the locate ended owns
        // nothing, so the re-armed pass is the only thing that wrote.
        expect(writeBatches()).toHaveLength(2);
        expect(nativeLiveAutomationWriter.pass?.entrySeconds).toBe(0.5);
        expect(writesOf(1)).toEqual([step(0.5, 0.6), step(0.55, 0.5)]);
    });

    it('keeps a curved lane fed every tick without the engine ever refusing it for capacity', async () => {
        // Ten linear segments inside one 0.1 s lookahead, which is what a
        // non-linear lane compiles to. A fixed per-pump fill either sends fewer
        // than the queue can take, or is refused for the slots the ledger still
        // holds; only the mirrored ledger sends exactly what fits.
        const engine = engineQueueBackend();
        mocks.apply.mockImplementation((batch) => engine.apply(batch));
        mocks.curve = [{ target: FADER, writes: curvedLane(60) }];

        arm(0);
        await flush();
        for (let tick = 1; tick <= 60; tick++) {
            engineEchoSeconds = tick * 0.01;
            await pump(engineEchoSeconds, 0);
        }

        const refusals = mocks.warn.mock.calls.filter(([message]) => String(message).includes('refused'));
        expect(refusals).toEqual([]);
        // Every segment reached the engine, and none of them twice.
        const sent = writeBatches().flatMap((commands) => commands.map((command) => command.write));
        expect(sent).toEqual(curvedLane(60));
    });

    it('re-offers a refused batch unchanged, and says the queue is full once for the pass', async () => {
        mocks.curve = [{ target: FADER, writes: curvedLane(9) }];

        arm(0);
        await flush();

        // Capacity less one slot of margin: the mirror releases on an echoed
        // playhead a frame or two behind the engine's own, and the engine's
        // ledger also holds a stamp until its batch is proven drained.
        expect(writesOf(0)).toHaveLength(AUTOMATION_QUEUE_CAPACITY - 1);
        expect(nativeLiveAutomationWriter.pass?.targets[0]?.cursor).toBe(AUTOMATION_QUEUE_CAPACITY - 1);

        engineEchoSeconds = 0.08;
        mocks.apply.mockResolvedValueOnce(QUEUE_FULL);
        await pump(0.08, 0);

        // A refusal is whole-batch, before anything is pushed: the cursor is a
        // claim that the engine took those writes, and it took none of them.
        expect(nativeLiveAutomationWriter.pass?.targets[0]?.cursor).toBe(AUTOMATION_QUEUE_CAPACITY - 1);

        mocks.apply.mockResolvedValueOnce(QUEUE_FULL);
        await pump(0.08, 0);
        await pump(0.08, 0);

        expect(writesOf(1)).toEqual(writesOf(2));
        expect(writesOf(2)).toEqual(writesOf(3));
        expect(nativeLiveAutomationWriter.pass?.targets[0]?.cursor).toBe(9);
        // Twice refused, said once: a full queue on every animation frame is a
        // log nobody can read past.
        const refusals = mocks.warn.mock.calls.filter(([message]) => String(message).includes('refused'));
        expect(refusals).toHaveLength(1);
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

    it('claims nothing for a batch a disarm overtook while it was still in flight', async () => {
        mocks.curve = [{ target: FADER, writes: [step(0, 0.9), step(0.05, 0.8)] }];

        const inFlight = deferApply();
        arm(0);
        await flush();
        const slot = nativeLiveAutomationWriter.pass?.targets[0];
        expect(slot?.cursor).toBe(0);

        disarmNativeLiveAutomationWriter();
        inFlight.settle(APPLIED);
        await flush();

        // The engine answered a pass that no longer exists. Advancing its
        // cursor would make the next pass believe those writes are still queued
        // when the disarm's own park has already resolved them.
        expect(slot?.cursor).toBe(0);
        await pump(0.5, 0);
        expect(mocks.apply).toHaveBeenCalledTimes(1);
    });

    it('drops a position the feed read for the pass a re-arm had already replaced', async () => {
        mocks.curve = [{ target: FADER, opensAt: 0.3, writes: [step(3.9, 0.9)] }];
        nativeEnginePlayheadFeed.running = true;

        arm(3.9);
        await flush();

        // A poll goes out against this pass, and answers after a locate ended
        // it. Its position is where the musician was, not where they are.
        let answer: (reading: EngineTransportPosition) => void = () => undefined;
        mocks.readPosition.mockReturnValueOnce(
            new Promise<EngineTransportPosition>((resolve) => {
                answer = resolve;
            })
        );
        pollNativeEnginePlayheadOnce();

        arm(2.1);
        await flush();
        const pass = nativeLiveAutomationWriter.pass;
        const batchesBefore = writeBatches().length;

        answer({
            running: true,
            playing: true,
            positionSeconds: 3.9,
            playheadFrame: 3.9 * SAMPLE_RATE,
            loopWraps: 4,
            batchesApplied: 0,
            tempo: 120,
            timeSigNum: 4,
            timeSigDenom: 4,
        });
        await flush();

        expect(writeBatches()).toHaveLength(batchesBefore);
        expect(pass?.lastLoopWraps).toBeNull();
        expect(pass?.targets[0]?.cursor).toBe(1);

        // The next tick, read for this pass, is admitted normally.
        await pump(3.85, 4);
        expect(writesOf(batchesBefore)).toEqual([step(3.9, 0.9)]);
    });

    it('ignores a snapshot the engine published before the locate that opened this pass', async () => {
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 2, endSeconds: 10 };
        nativeLiveGraphSession.loopEnabled = true;
        mocks.curve = [{ target: FADER, opensAt: 0.55, writes: [step(3, 0.9), step(6.1, 0.6)] }];

        // Armed after a locate forward to 6, whose batch the engine will have
        // drained once its count reaches 4.
        arm(6, 4);
        await flush();
        expect(writesOf(0)).toEqual([step(6, 0.55)]);

        // A poll issued before that locate answers now. It carries this pass's
        // epoch, and a position from the world the locate replaced. Only the
        // batch count says so: the transport publishes once per callback, and
        // an apply resolves when the batch is fenced, not when it is drained.
        await pump(2.52, 0, 3);

        expect(writeBatches()).toHaveLength(1);
        // Nothing of it was taken — a position behind the entry reads as a wrap
        // to any pass that trusts it, and this one flushes the region's whole
        // curve as writes the engine resolves in a single block.
        expect(nativeLiveAutomationWriter.pass?.lastLoopWraps).toBeNull();
        expect(nativeLiveAutomationWriter.pass?.targets[0]?.cursor).toBe(1);

        // The first snapshot the engine published after the locate drained.
        await pump(6.01, 0, 4);
        expect(writesOf(1)).toEqual([step(6.1, 0.6)]);
    });

    it('carries the queue mirror across a seam, so the region reopens without overfilling the engine', async () => {
        // The engine's ledger does not forget at a seam: its own release proof
        // needs a whole further pass. A loop span that opens on steps is where
        // that matters, because a step appends rather than cancelling what is
        // queued ahead of it.
        const engine = engineQueueBackend();
        mocks.apply.mockImplementation((batch) => engine.apply(batch));
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 1, endSeconds: 1.1 };
        nativeLiveGraphSession.loopEnabled = true;
        mocks.curve = [
            {
                target: FADER,
                opensAt: 0.5,
                writes: [
                    step(1.01, 0.9),
                    step(1.02, 0.8),
                    step(1.03, 0.7),
                    step(1.04, 0.6),
                    step(1.05, 0.5),
                    step(1.06, 0.4),
                    step(1.07, 0.3),
                    step(1.08, 0.2),
                ],
            },
        ];

        arm(1, 1);
        await flush();

        engineEchoSeconds = 1.05;
        await pump(1.05, 0, 1);

        // The seam. The engine is walking the region again from its start, and
        // everything the pass sent for the stretch it just left is still
        // charged against the parameter's queue.
        engineEchoSeconds = 1.005;
        await pump(1.005, 1, 1);

        const refusals = mocks.warn.mock.calls.filter(([message]) => String(message).includes('refused'));
        expect(refusals).toEqual([]);
        // What fits beside what is still queued, and no more: the reopened
        // region establishes its value and steps forward from there.
        expect(writesOf(2)).toEqual([step(1, 0.5), step(1.01, 0.9), step(1.02, 0.8)]);
    });

    it('drops a step stamped at the loop end rather than starving the lane one dead copy per pass', async () => {
        // The engine renders frames strictly below the loop end while it wraps
        // (`render_timeline_spans`), and the wrap is not a locate, so a stamp
        // on the end frame is never walked past: it sits in the queue
        // unreleased, every pass resends it, and seven passes later the lane's
        // whole queue is dead copies of a write that never sounded.
        const engine = engineQueueBackend();
        mocks.apply.mockImplementation((batch) => engine.apply(batch));
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 2, endSeconds: 4 };
        nativeLiveGraphSession.loopEnabled = true;
        mocks.curve = [
            {
                target: FADER,
                opensAt: 0.5,
                writes: [step(2.5, 0.9), step(2.95, 0.8), step(3.45, 0.7), step(3.95, 0.6), step(4, 0.1)],
            },
        ];

        arm(2, 1);
        await flush();

        // Nine passes — two past the queue's seven usable slots. Each tick's
        // window holds one write, so the ledger fake's apply-time echo proves
        // every stamp popped as the playhead passes it, and the last tick
        // stands past the final interior step so its stamp releases before
        // the wrap.
        let wraps = 0;
        for (let pass = 0; pass < 9; pass++) {
            for (const at of [2.45, 2.9, 3.4, 3.99]) {
                engineEchoSeconds = at;
                await pump(at, wraps, 1);
            }
            wraps += 1;
            engineEchoSeconds = 2.05;
            await pump(2.05, wraps, 1);
        }

        const refusals = mocks.warn.mock.calls.filter(([message]) => String(message).includes('refused'));
        expect(refusals).toEqual([]);
        const sent = writeBatches().flatMap((commands) => commands.map((command) => command.write));
        // The end-stamped step never left this side…
        expect(sent).not.toContainEqual(step(4, 0.1));
        // …and the lane it would have silenced sounds on every pass: the
        // opening set once per pass plus the arm's own, each interior step
        // once per pass walked.
        expect(sent.filter((write) => write.shape === 'step' && write.time === 2 && write.value === 0.5)).toHaveLength(
            10
        );
        for (const at of [2.5, 2.95, 3.45, 3.95]) {
            expect(sent.filter((write) => write.shape === 'step' && write.time === at)).toHaveLength(9);
        }
        // Nine passes in, the mirror holds only what this pass still owes the
        // engine: the opening set it just sent, and the last interior step
        // carried across the seam until the playhead passes it again. Nothing
        // stamped at or past the end frame survives a single wrap.
        expect(nativeLiveAutomationWriter.pass?.targets[0]?.queued).toEqual([
            { startFrame: Math.round(3.95 * SAMPLE_RATE), landFrame: Math.round(3.95 * SAMPLE_RATE) },
            { startFrame: Math.round(2 * SAMPLE_RATE), landFrame: Math.round(2 * SAMPLE_RATE) },
        ]);
    });

    it('counts a step as an append, so the writes it does not cancel keep their slots', async () => {
        // `charge_automation` drops the stale only for a write that is not an
        // `Append`. A mirror that let a step cancel would believe a queue it
        // never emptied was empty, and offer the engine writes there is no room
        // for. Each pair below is a ramp still gliding when the next step is
        // stamped: the step keeps it, a replace would drop it.
        const engine = engineQueueBackend();
        mocks.apply.mockImplementation((batch) => engine.apply(batch));
        const pairs = Array.from({ length: 8 }, (_unused, index) => {
            const at = 0.01 + index * 0.003;
            return [ramp(at, at + 0.002, 0.2 + index * 0.05), step(at + 0.001, 0.9 - index * 0.05)];
        });
        mocks.curve = [{ target: FADER, writes: pairs.flat() }];

        arm(0, 1);
        await flush();

        const refusals = mocks.warn.mock.calls.filter(([message]) => String(message).includes('refused'));
        expect(refusals).toEqual([]);
        // Every slot the mirror may fill, and the step holding one of every
        // two: a mirror that let a step cancel would have offered more.
        expect(writesOf(0)).toEqual(pairs.flat().slice(0, AUTOMATION_QUEUE_CAPACITY - 1));
    });

    it('reports an unchanged exclusion set once, however often the pass is re-armed', async () => {
        mocks.curve = [{ target: FADER, writes: [step(0, 0.9)] }];
        mocks.exclusions = [{ stripId: 'track-a', subjectId: 'lane-smoothed', reason: 'smoothed-write-unsupported' }];

        arm(0);
        await flush();
        arm(0.5);
        await flush();

        expect(mocks.warn.mock.calls.filter(([message]) => String(message).includes('excluded'))).toHaveLength(1);

        mocks.exclusions = [
            { stripId: 'track-a', subjectId: 'lane-smoothed', reason: 'smoothed-write-unsupported' },
            { stripId: 'track-b', subjectId: 'lane-device', reason: 'device-parameter-unsupported' },
        ];
        arm(1);
        await flush();

        // The set moved, so it is worth saying again — and it is the new lane
        // that has to be readable, which is what repeating the old one buries.
        expect(mocks.warn.mock.calls.filter(([message]) => String(message).includes('excluded'))).toHaveLength(3);
    });
});
