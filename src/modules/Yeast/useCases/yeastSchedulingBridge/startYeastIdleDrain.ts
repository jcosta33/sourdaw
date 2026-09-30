import { transportStore } from '#/modules/Transport/stores';

import { processYeastMidi } from './processYeastMidi';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';

type ScheduleTick = (callback: () => void, delayMs: number) => () => void;

const setTimeoutTick: ScheduleTick = (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => {
        clearTimeout(handle);
    };
};

type StartYeastIdleDrainInput = {
    context: BaseAudioContext;
    rackId: string;
    routeId: string;
    trackId: string;
    /** Snapshot of the transport as the owning input saw it (stopped). */
    transport: TransportInfo;
    /** Exclusive end of the last block the input path already processed. */
    firstBlockEndSamples: number;
    /** Furthest sample time a known generated event can still be followed by another. */
    horizonSamples: number;
    strideSamples: number;
    /**
     * Receives each drained batch for dispatch on its instrument routes.
     * Returning `false` retires the pump — the owning input session ended.
     */
    onEvents: (events: readonly MidiEvent[]) => boolean | void;
    scheduleTick?: ScheduleTick;
};

/**
 * Safety margin over the horizon-derived tick bound (#4870). The bound is
 * recomputed whenever a drained batch extends the horizon, so the margin only
 * has to carry the final quiet confirmation round and stride alignment — four
 * windows, against a reachable repeater tail (20 BPM, rate_denom 24, gate 2.0,
 * repeat_count 16 → last note-off ≈ 9 s out ≈ 90 windows at the 0.1 s stride)
 * that the horizon term itself already covers.
 */
const TICK_BOUND_SAFETY = 4;

/**
 * Absolute runaway guard, sized far above any reachable horizon so only a
 * pathological self-extending drain ever reaches it. Worst reachable single
 * tail from the UI clamps (#4870): repeater repeat_count 16 (max), rate_denom
 * 1 (min → interval 4 beats), gate 2.0 (max → note length 2 intervals) at
 * MIN_TEMPO 20 (beat = 3 s) → final note-off 16 × 12 s + 24 s = 216 s after
 * the struck note, ≈ 2160 windows at the 0.1 s stride. Chained generators can
 * stack further such tails and the horizon-derived bound tracks them; this
 * ceiling only has to stay out of every such horizon's way.
 */
export const MAX_DRAIN_TICKS = 8192;

/**
 * One pump per rack route: a new input on the same route retires the previous
 * pump, so a drain never outlives the input session that owns it (#4870).
 */
const activeDrains = new Map<string, () => void>();

function drainKey(rackId: string, routeId: string): string {
    return `${rackId}:${routeId}`;
}

/**
 * Keep processing empty Yeast blocks after a live input's own block until the
 * rack's generated and deferred events are drained (#4870).
 *
 * With Web MIDI as the only driver of a rack — transport stopped, no active
 * clip carrier — the playback scheduler never runs, so a note-off a
 * processor queued for a LATER block (an arpeggiator's tied lifetime) would
 * never fire and the voice it releases would hang. The pump advances empty
 * block windows on the same sample clock, hands every drained batch back
 * through `onEvents` for dispatch, and stops once a quiet round has passed
 * the furthest known horizon. Each returned batch that carries a longer
 * note lifetime extends that horizon; the pump also stops if the transport
 * starts playing (the scheduler owns driving then), if cancelled, when a new
 * pump supersedes it on the same route, and at the absolute tick ceiling.
 */
export function startYeastIdleDrain(input: StartYeastIdleDrainInput): () => void {
    const key = drainKey(input.rackId, input.routeId);
    activeDrains.get(key)?.();

    const scheduleTick = input.scheduleTick ?? setTimeoutTick;
    let cancelled = false;
    let cancelTick: (() => void) | null = null;
    let ticks = 0;
    let blockStartSamples = input.firstBlockEndSamples;
    let horizonSamples = input.horizonSamples;

    const stop = (): void => {
        cancelled = true;
        cancelTick?.();
        cancelTick = null;
        if (activeDrains.get(key) === cancel) {
            activeDrains.delete(key);
        }
    };
    const cancel = (): void => {
        stop();
    };

    /**
     * Ticks this pump may still run (#4870): enough windows to cover the
     * current horizon plus the safety margin, recomputed as drained batches
     * extend the horizon. The two invariants this serves: an in-flight
     * window's events are always delivered, and the pump covers every
     * reachable horizon and retires only past it.
     */
    const ticksAllowed = (): number =>
        Math.min(
            MAX_DRAIN_TICKS,
            Math.ceil((horizonSamples - input.firstBlockEndSamples) / input.strideSamples) + TICK_BOUND_SAFETY
        );

    const runTick = (): void => {
        if (cancelled) {
            return;
        }
        ticks += 1;
        if (ticks > ticksAllowed() || (transportStore.value?.isPlaying ?? false)) {
            stop();
            return;
        }
        const blockEndSamples = blockStartSamples + input.strideSamples;
        void processYeastMidi({
            context: input.context,
            rackId: input.rackId,
            routeId: input.routeId,
            trackId: input.trackId,
            events: [],
            blockStartSamples,
            blockEndSamples,
            transport: input.transport,
        })
            .then((events) => {
                // #4870 — an in-flight window's events are always delivered:
                // the rack has already dequeued them from every queue and can
                // never re-emit them, so a dropped note-off would hang its
                // captured voice. Supersession or cancellation retires only
                // the continuation below — no window advance, no horizon
                // extension, no next tick.
                if (events.length > 0) {
                    if (input.onEvents(events) === false) {
                        stop();
                        return;
                    }
                }
                if (cancelled) {
                    return;
                }
                blockStartSamples = blockEndSamples;
                for (const event of events) {
                    if (event.kind.type === 'noteOn' && event.durationSamples !== undefined) {
                        horizonSamples = Math.max(horizonSamples, event.timeSamples + event.durationSamples);
                    }
                }
                if (blockEndSamples >= horizonSamples && events.length === 0) {
                    stop();
                    return;
                }
                cancelTick = scheduleTick(runTick, 0);
            })
            .catch(() => {
                // The runtime already reports its own failures; a pump that
                // cannot drive the rack must simply retire.
                stop();
            });
    };

    cancelTick = scheduleTick(runTick, 0);
    activeDrains.set(key, cancel);
    return cancel;
}
