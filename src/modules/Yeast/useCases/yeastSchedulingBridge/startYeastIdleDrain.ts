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
 * Bound on the drain rounds per pump. With the transport stopped nothing
 * generates new material indefinitely, so this only ever fires on a
 * pathological horizon; the drain's job is bounded cleanup, not a second
 * transport (#4870).
 */
const MAX_DRAIN_TICKS = 64;

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
 * pump supersedes it on the same route, and at a hard round cap.
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

    const runTick = (): void => {
        if (cancelled) {
            return;
        }
        ticks += 1;
        if (ticks > MAX_DRAIN_TICKS || (transportStore.value?.isPlaying ?? false)) {
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
                if (cancelled) {
                    return;
                }
                blockStartSamples = blockEndSamples;
                for (const event of events) {
                    if (event.kind.type === 'noteOn' && event.durationSamples !== undefined) {
                        horizonSamples = Math.max(horizonSamples, event.timeSamples + event.durationSamples);
                    }
                }
                if (events.length > 0) {
                    if (input.onEvents(events) === false) {
                        stop();
                        return;
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
