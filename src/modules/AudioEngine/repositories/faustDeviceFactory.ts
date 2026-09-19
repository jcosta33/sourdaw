/**
 * Repository: Faust DSP device node factory.
 *
 * Creates OfflineDeviceNode wrappers around Faust AudioWorkletNodes,
 * making them compatible with the device chain builder.
 *
 * Since Faust nodes are single AudioNodes that handle both input and output,
 * the wrapper simply uses the same node for inputNode and outputNode.
 */

import { type IFaustMonoWebAudioNode, type IFaustPolyWebAudioNode } from '@grame/faustwasm';

import { logger } from '#/infra/logger/appLogger';

import { type OfflineDeviceNode } from './deviceNodeFactory';

type FaustNode = IFaustMonoWebAudioNode | IFaustPolyWebAudioNode;

type CreateFaustNode = (faustModuleId: string, ctx: BaseAudioContext) => Promise<FaustNode | null>;

type CreateFaustDeviceInput = {
    ctx: BaseAudioContext;
    faustModuleId: string;
    compileFaustDSP: (faustModuleId: string) => Promise<boolean>;
    createFaustNode: CreateFaustNode;
};

/**
 * Create a Faust device node for the device chain.
 *
 * Ensures the module is compiled, then creates an AudioWorkletNode.
 * Returns null if compilation or node creation fails — the chain builder
 * should skip this device gracefully.
 */
export async function createFaustDevice({
    ctx,
    faustModuleId,
    compileFaustDSP,
    createFaustNode,
}: CreateFaustDeviceInput): Promise<OfflineDeviceNode | null> {
    const compiled = await compileFaustDSP(faustModuleId);
    if (!compiled) {
        logger.warn(`[FaustDevice] Failed to compile ${faustModuleId}`);
        return null;
    }

    const node = await createFaustNode(faustModuleId, ctx);
    if (!node) {
        logger.warn(`[FaustDevice] Failed to create node for ${faustModuleId}`);
        return null;
    }

    const paramAddressCache = buildParamAddressCache(node);

    // keyOn/keyOff in @grame/faustwasm are port.postMessage calls; they are NOT
    // sample-accurate. We schedule them via setTimeout relative to ctx.currentTime
    // so timeline-scheduled notes still fire near their target time. In offline
    // rendering, we use ctx.suspend() to achieve block-accurate timing (since
    // setTimeout would miss entirely). For tighter real-time scheduling, a
    // processor-side look-ahead scheduler would be required.
    const scheduleCall =
        typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext
            ? makeOfflineScheduler(ctx)
            : makeLiveScheduler(ctx as AudioContext);

    return {
        inputNode: node,
        outputNode: node,
        nodes: [node],
        wamControls: {
            setParam: (name: string, value: number) => {
                const resolved = paramAddressCache.get(name) ?? name;
                try {
                    node.setParamValue(resolved, value);
                } catch (error) {
                    logger.warn(`[FaustDevice] Failed to set param ${resolved} to ${value}:`, error);
                }
            },
            scheduleParam: (name: string, value: number, time: number) => {
                if (!(node instanceof AudioWorkletNode)) {
                    return;
                }
                const resolved = paramAddressCache.get(name) ?? name;
                const targetParam = node.parameters.get(resolved);
                if (targetParam) {
                    targetParam.setValueAtTime(value, time);
                }
            },
            keyOn: (channel: number, pitch: number, velocity: number, time?: number) => {
                if ('keyOn' in node) {
                    scheduleCall(time, () => node.keyOn(channel, pitch, velocity));
                }
            },
            keyOff: (channel: number, pitch: number, velocity: number, time?: number) => {
                if ('keyOff' in node) {
                    scheduleCall(time, () => node.keyOff(channel, pitch, velocity));
                }
            },
            destroy: () => {
                try {
                    node.destroy();
                } catch (error) {
                    logger.warn(`[FaustDevice] Failed to destroy node:`, error);
                }
            },
        },
    };
}

type ScheduleCall = (time: number | undefined, call: () => void) => void;

/**
 * Offline scheduler: batch all note events sharing a sample frame behind a
 * single `ctx.suspend(time)` instead of registering O(N) suspend→resume
 * transitions (one per note). Two notes that land on the same frame previously
 * threw "cannot schedule a suspend at frame X" on the second `suspend()` call,
 * which was caught and fired the note immediately at the wrong time. Quantising
 * `time` to the context sample frame collapses near-duplicates so each distinct
 * frame gets exactly one suspend whose handler runs every queued call in order.
 */
function makeOfflineScheduler(ctx: OfflineAudioContext): ScheduleCall {
    const { sampleRate } = ctx;
    // Keyed by quantised sample frame. Each entry holds every call due at that
    // frame; the first call to a frame registers a single suspend for it.
    const callsByFrame = new Map<number, (() => void)[]>();

    return (time, call) => {
        if (time === undefined || time <= ctx.currentTime) {
            call();
            return;
        }

        // Quantise to the nearest sample frame so float drift between notes that
        // are meant to share a frame does not split into two suspends.
        const frame = Math.max(0, Math.round(time * sampleRate));
        const quantTime = frame / sampleRate;

        const existing = callsByFrame.get(frame);
        if (existing) {
            // A suspend for this frame is already registered — just append.
            existing.push(call);
            return;
        }

        const calls: (() => void)[] = [call];
        callsByFrame.set(frame, calls);

        function fireImmediately(): void {
            runCalls(calls);
            callsByFrame.delete(frame);
        }

        function onSuspend(): Promise<void> {
            runCalls(calls);
            return ctx.resume();
        }

        try {
            void ctx
                .suspend(quantTime)
                .then(onSuspend)
                // suspend() rejects (rather than throws) when the frame is already
                // in the past by the time it is registered. Fire this frame's
                // calls immediately as a best-effort fallback rather than dropping
                // the notes or leaving an unhandled rejection.
                .catch(fireImmediately);
        } catch {
            // Some implementations throw synchronously instead of rejecting.
            fireImmediately();
        }
    };
}

/** Invoke every queued callback for a frame, in registration order. */
function runCalls(calls: (() => void)[]): void {
    for (const queued of calls) {
        queued();
    }
}

/**
 * Live scheduler: route note events through one sample-frame-sorted queue driven
 * by a single timer, instead of a per-call `setTimeout` (which imposes a ~4ms
 * minimum delay and reorders notes whose target times fall inside the same wake
 * jitter window). The queue is ordered by target time so a note-off never
 * overtakes the note-on it releases, and one shared timer wakes for the earliest
 * pending event and drains everything now due in order.
 */
function makeLiveScheduler(ctx: AudioContext): ScheduleCall {
    type Pending = { time: number; seq: number; call: () => void };
    const queue: Pending[] = [];
    let seqCounter = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function drain(): void {
        timer = null;
        const now = ctx.currentTime;
        // Fire everything at or before now, in queued (time, then arrival) order.
        while (queue.length > 0 && queue[0]!.time <= now) {
            const next = queue.shift()!;
            next.call();
        }
        scheduleWake();
    }

    function scheduleWake(): void {
        if (timer !== null || queue.length === 0) {
            return;
        }
        const waitMs = Math.max(0, (queue[0]!.time - ctx.currentTime) * 1000);
        timer = setTimeout(drain, waitMs);
    }

    return (time, call) => {
        if (time === undefined || time <= ctx.currentTime) {
            call();
            return;
        }

        const entry: Pending = { time, seq: seqCounter++, call };
        // Insert keeping the queue sorted by (time, arrival order) so events that
        // share a target frame fire in the order they were scheduled (on before
        // its matching off). Linear insert is fine: live note bursts are small.
        let lo = 0;
        let hi = queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            const probe = queue[mid]!;
            if (probe.time < time || (probe.time === time && probe.seq < entry.seq)) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        queue.splice(lo, 0, entry);

        // If this new event is now the earliest, re-arm the timer for it.
        if (lo === 0 && timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        scheduleWake();
    };
}

function buildParamAddressCache(node: FaustNode): Map<string, string> {
    const cache = new Map<string, string>();
    if (!(node instanceof AudioWorkletNode)) {
        return cache;
    }
    for (const [key] of node.parameters) {
        const bareName = key.split('/').pop();
        if (!bareName) {
            continue;
        }
        const existing = cache.get(bareName);
        if (existing !== undefined) {
            logger.warn(`[FaustDevice] Duplicate bare param "${bareName}" — keeping "${existing}", ignoring "${key}"`);
            continue;
        }
        cache.set(bareName, key);
    }
    return cache;
}
