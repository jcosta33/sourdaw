import { describe, it, expect, vi, afterEach } from 'vitest';

import { createFaustDevice } from '../../faustDeviceFactory';
import { makeOfflineFrameScheduler } from '../makeOfflineFrameScheduler';
import { quantiseSuspendFrame } from '../quantiseSuspendFrame';

const SAMPLE_RATE = 48_000;
// Far below half a sample frame (1 / 96_000 s), so the two times stay in one frame.
const SUB_FRAME_DRIFT = 1e-9;

type SuspendRecord = {
    time: number;
    resolve: () => void;
    reject: (reason: Error) => void;
};

type ContextDouble = {
    ctx: OfflineAudioContext;
    /** The class `ctx` instantiates, for the `instanceof OfflineAudioContext` gates under test. */
    ContextClass: new () => unknown;
    suspends: SuspendRecord[];
    resumeCount: () => number;
};

type SuspendMode = 'defer' | 'throw';
type ResumeMode = 'resolve' | 'reject';

type ContextDoubleOptions = {
    sampleRate?: number;
    currentTime?: number;
    suspendMode?: SuspendMode;
    resumeMode?: ResumeMode;
};

/**
 * Controllable OfflineAudioContext double: records every suspend(time) and
 * settles it on demand. A second suspend for a frame already registered throws,
 * as the platform's does — the refusal the scheduler's fallback would turn into
 * an immediate, early firing.
 */
function makeContextDouble(options: ContextDoubleOptions = {}): ContextDouble {
    const suspends: SuspendRecord[] = [];
    const resolvedSampleRate = options.sampleRate ?? SAMPLE_RATE;
    const suspendMode = options.suspendMode ?? 'defer';
    const resumeMode = options.resumeMode ?? 'resolve';
    let resumeCount = 0;

    class OfflineAudioContextDouble {
        readonly sampleRate = resolvedSampleRate;
        currentTime = options.currentTime ?? 0;

        suspend(time: number): Promise<void> {
            if (suspendMode === 'throw') {
                throw new Error('suspend threw synchronously');
            }
            if (suspends.some((record) => record.time === time)) {
                throw new Error(`cannot schedule a suspend at frame ${Math.round(time * resolvedSampleRate)}`);
            }
            return new Promise<void>((resolve, reject) => {
                suspends.push({ time, resolve, reject });
            });
        }

        resume(): Promise<void> {
            resumeCount += 1;
            if (resumeMode === 'reject') {
                return Promise.reject(new Error('resume rejected after the frame ran'));
            }
            return Promise.resolve();
        }
    }

    return {
        ctx: new OfflineAudioContextDouble() as unknown as OfflineAudioContext,
        ContextClass: OfflineAudioContextDouble,
        suspends,
        resumeCount: () => resumeCount,
    };
}

async function flushMicrotasks(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('makeOfflineFrameScheduler — immediate path', () => {
    it('runs a call at or before currentTime immediately and registers no suspend', () => {
        const { ctx, suspends } = makeContextDouble({ currentTime: 5 });
        const schedule = makeOfflineFrameScheduler(ctx);
        const atPresent = vi.fn();
        const inPast = vi.fn();
        const withoutTime = vi.fn();

        schedule(5, atPresent);
        schedule(4.9, inPast);
        schedule(undefined, withoutTime);

        expect(atPresent).toHaveBeenCalledTimes(1);
        expect(inPast).toHaveBeenCalledTimes(1);
        expect(withoutTime).toHaveBeenCalledTimes(1);
        expect(suspends).toHaveLength(0);
    });
});

describe('makeOfflineFrameScheduler — one scheduler per OfflineAudioContext', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the same scheduler for a context and a distinct one for another context', () => {
        const first = makeContextDouble();
        const second = makeContextDouble();

        expect(makeOfflineFrameScheduler(first.ctx)).toBe(makeOfflineFrameScheduler(first.ctx));
        expect(makeOfflineFrameScheduler(first.ctx)).not.toBe(makeOfflineFrameScheduler(second.ctx));
    });

    it('runs a Faust note and a frame-addressed write due on the same frame together, firing neither early', async () => {
        const { ctx, ContextClass, suspends } = makeContextDouble();
        vi.stubGlobal('OfflineAudioContext', ContextClass);
        const keyOn = vi.fn();
        const write = vi.fn();

        // The Faust caller reaches the scheduler through the factory's own
        // offline branch, exactly as `createFaustDevice` builds its
        // `scheduleCall` — not a private copy of the scheduler.
        const device = await createFaustDevice({
            ctx,
            faustModuleId: 'faust',
            compileFaustDSP: vi.fn().mockResolvedValue(true),
            createFaustNode: vi.fn().mockResolvedValue({ keyOn, keyOff: vi.fn() }),
        });
        // The frame-addressed caller registers its write the way
        // `scheduleCurveWritePoints` does: through the scheduler for this
        // context, which is what the render root asks the factory for.
        const scheduleFrame = makeOfflineFrameScheduler(ctx);

        device!.wamControls!.keyOn!(0, 60, 100, 1);
        scheduleFrame(1, write);

        // Both calls share the context's one scheduler, so one suspend covers
        // the frame. With a scheduler apiece the second suspend would throw and
        // its fallback would fire `write` at once, at frame 0.
        expect(suspends).toHaveLength(1);
        expect(keyOn).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();

        suspends[0]!.resolve();
        await flushMicrotasks();

        expect(keyOn).toHaveBeenCalledWith(0, 60, 100);
        expect(write).toHaveBeenCalledTimes(1);
    });
});

describe('makeOfflineFrameScheduler — one suspend per quantised frame', () => {
    it('registers exactly one suspend for two calls on the same frame and runs both in registration order', async () => {
        const { ctx, suspends, resumeCount } = makeContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const order: string[] = [];
        const first = vi.fn(() => order.push('first'));
        const second = vi.fn(() => order.push('second'));

        schedule(1, first);
        schedule(1, second);

        // A second suspend for an already-scheduled frame throws, so the second
        // call joins the first frame's batch instead of registering its own.
        expect(suspends).toHaveLength(1);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();

        suspends[0]!.resolve();
        await flushMicrotasks();

        expect(order).toEqual(['first', 'second']);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(resumeCount()).toBe(1);
    });

    it('collapses near-duplicate times inside one frame into that same single suspend', async () => {
        const { ctx, suspends } = makeContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const exact = vi.fn();
        const drifted = vi.fn();

        schedule(1, exact);
        schedule(1 + SUB_FRAME_DRIFT, drifted);

        expect(suspends).toHaveLength(1);

        suspends[0]!.resolve();
        await flushMicrotasks();

        expect(exact).toHaveBeenCalledTimes(1);
        expect(drifted).toHaveBeenCalledTimes(1);
    });

    it('registers the suspend at the render-quantum frame the context will suspend at', () => {
        const { ctx, suspends } = makeContextDouble({ sampleRate: SAMPLE_RATE });
        const schedule = makeOfflineFrameScheduler(ctx);
        const drifted = 0.3 + SUB_FRAME_DRIFT;

        schedule(drifted, vi.fn());

        const frame = Math.round(drifted * SAMPLE_RATE);
        expect(frame).toBe(14_400);
        const suspendFrame = quantiseSuspendFrame(frame);
        expect(suspendFrame).toBe(14_464);
        expect(suspends).toHaveLength(1);
        expect(suspends[0]!.time).toBe(suspendFrame / SAMPLE_RATE);
        // The requested time is rounded up onto its render quantum, not onto the
        // raw sample frame.
        expect(suspends[0]!.time).not.toBe(drifted);
    });
});

describe('makeOfflineFrameScheduler — suspend failure fallback', () => {
    it('runs the queued callbacks exactly once when the suspend promise rejects', async () => {
        const { ctx, suspends } = makeContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        schedule(1, first);
        schedule(1, second);

        expect(suspends).toHaveLength(1);
        suspends[0]!.reject(new Error('frame already passed'));
        await flushMicrotasks();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('runs each call exactly once when suspend throws synchronously', () => {
        const { ctx, suspends } = makeContextDouble({ suspendMode: 'throw' });
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        expect(() => {
            schedule(1, first);
            schedule(1, second);
        }).not.toThrow();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(suspends).toHaveLength(0);
    });
});

describe('makeOfflineFrameScheduler — exactly once after the frame has run', () => {
    it('runs each call exactly once when a resolved suspend resume rejects', async () => {
        const { ctx, suspends, resumeCount } = makeContextDouble({ resumeMode: 'reject' });
        const schedule = makeOfflineFrameScheduler(ctx);
        const first = vi.fn();
        const second = vi.fn();

        schedule(1, first);
        schedule(1, second);

        suspends[0]!.resolve();
        await flushMicrotasks();

        // The frame ran when its suspend resolved; a later resume failure must
        // not make the chained rejection fallback run the same frame again.
        expect(resumeCount()).toBe(1);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('runs a throwing queued callback once and does not re-run the frame', async () => {
        const { ctx, suspends } = makeContextDouble();
        const schedule = makeOfflineFrameScheduler(ctx);
        const before = vi.fn();
        const throwing = vi.fn(() => {
            throw new Error('queued callback failed');
        });
        const after = vi.fn();

        schedule(1, before);
        schedule(1, throwing);
        schedule(1, after);

        expect(suspends).toHaveLength(1);
        suspends[0]!.resolve();
        await flushMicrotasks();

        // A callback exception must not route the frame back through the
        // suspend-rejection fallback: no call in the frame runs twice.
        expect(before).toHaveBeenCalledTimes(1);
        expect(throwing).toHaveBeenCalledTimes(1);
        expect(after).not.toHaveBeenCalled();
    });
});
