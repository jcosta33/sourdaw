/**
 * MidiProcessor interface — the core contract for all Yeast MIDI effect modules.
 *
 * Each processor transforms a stream of MidiEvents, potentially adding, removing,
 * modifying, or retiming events. Processors are chained in a serial rack.
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';

import type { YeastPreviewDecisionSink } from './YeastPreviewSidecar';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';

export type MidiProcessorParams = Readonly<Record<string, number>>;

/**
 * Block-window fallback for a processor that EMITS into the window (every
 * generator: arp steps, euclidean steps, markov steps, CC ramps). One audio
 * render quantum. A wide fallback would make a direct `processMidi` call
 * generate far past the caller's intent.
 */
export const EMIT_FALLBACK_BLOCK_SPAN_SAMPLES = 128;

/**
 * Block-window fallback for a processor that only DRAINS its own internal
 * queue into the window (repeater echoes, strummed chord tones). A narrow
 * fallback would strand already-scheduled events indefinitely.
 */
export const DRAIN_FALLBACK_BLOCK_SPAN_SAMPLES = 8192;

/**
 * First sample of the block being processed.
 *
 * `MidiRack` always sets `blockStartSamples`; the input/zero fallbacks serve
 * isolated unit specs that drive a processor directly.
 */
export function resolveBlockStartSamples(transport: TransportInfo, input: readonly MidiEvent[]): number {
    return transport.blockStartSamples ?? input[0]?.timeSamples ?? 0;
}

/**
 * Exclusive sample boundary of the block being processed.
 *
 * `MidiRack` always sets `blockEndSamples`. `fallbackSpanSamples` applies only
 * when it is absent — pass `EMIT_FALLBACK_BLOCK_SPAN_SAMPLES` when the window
 * bounds generation and `DRAIN_FALLBACK_BLOCK_SPAN_SAMPLES` when it only
 * bounds an internal-queue drain.
 */
export function resolveBlockEndSamples(
    transport: TransportInfo,
    blockStartSamples: number,
    fallbackSpanSamples: number
): number {
    return transport.blockEndSamples ?? blockStartSamples + fallbackSpanSamples;
}

export type MidiProcessor = {
    readonly id: string;
    readonly name: string;
    readonly providesPreviewDecisions?: boolean;

    /**
     * Process one block of MIDI events. Append output events to `output`.
     *
     * A block is the half-open sample window
     * `[transport.blockStartSamples, transport.blockEndSamples)`. Where a
     * processor controls its own timing it should stay inside that window: a
     * generator steps to the block containing its step, and a processor that
     * wants to place an event later holds it in its own `ScheduledEventQueue`
     * rather than emitting it ahead of time.
     *
     * The rack rejects nothing. It routes the chain's output by time, once:
     * an event at or beyond `blockEndSamples` is deferred and released in the
     * block that contains it; an event before `blockStartSamples` is released
     * immediately, in the block that produced it. The lower bound is a release
     * rather than a rejection because timing processors emit below the window
     * by design — Humanizer's rushed preset carries a negative timing mean and
     * GrooveModule applies negative template offsets.
     *
     * What the rack does enforce is direction. A deferred event rejoins the
     * chain's OUTPUT, never its input, so a generator can never ingest its own
     * output as a fresh held note and no event traverses the chain twice.
     */
    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void;

    /** Reset all internal state (on transport stop, panic, etc.). */
    reset(): void;

    /** Set bypass state. When bypassed, events pass through unmodified. */
    setBypassed(bypassed: boolean): void;

    /** Whether this processor is currently bypassed. */
    isBypassed(): boolean;

    /** Set the route whose block is currently being processed. */
    setTrackId?(trackId: string | undefined): void;

    /** Set a named parameter. */
    setParam(name: string, value: number): void;

    /** Replace the complete sparse set of durable parameter overrides. */
    replaceParams(params: MidiProcessorParams): void;

    /** Execute a typed one-shot command; unsupported processors return false. */
    executeCommand?(command: YeastProcessorCommand): boolean;

    /** Get the processor's reported latency in samples. */
    latencySamples(): number;
};

/**
 * Tracks active generated notes to ensure proper Note Off handling.
 * Every Note On must have exactly one eventual Note Off.
 */
export type ActiveNote = {
    channel: number;
    note: number;
    noteInstanceId?: string;
    offTimeSamples: number;
    trackId?: string;
};

/**
 * Scheduled event queue — stores future events across block boundaries.
 * Used by processors that emit delayed events (arp, repeater, strum, etc.).
 */
export class ScheduledEventQueue {
    private events: MidiEvent[] = [];

    /** Schedule a future event. */
    push(event: MidiEvent): void {
        this.events.push(event);
    }

    /**
     * Drain all events whose time falls within [start, end) into `out` (which
     * must be empty on entry), sorting the result in place. Partitions
     * `this.events` in place, and the caller owns `out`, so a processor
     * draining once per block reuses one buffer and allocates nothing
     * (§149.1).
     */
    drainRangeInto(startSamples: number, endSamples: number, out: MidiEvent[], trackId?: string): MidiEvent[] {
        const src = this.events;
        let writeIdx = 0;
        for (let index = 0; index < src.length; index++) {
            const event = src[index]!;
            if (
                event.timeSamples >= startSamples &&
                event.timeSamples < endSamples &&
                (trackId === undefined || event.trackId === trackId)
            ) {
                out.push(event);
            } else {
                src[writeIdx++] = event;
            }
        }
        src.length = writeIdx;
        out.sort((alpha, b) => alpha.timeSamples - b.timeSamples);
        return out;
    }

    /**
     * Flush all scheduled Note Ons as immediate Note Offs.
     *
     * Each distinct (track, channel, note) yields exactly one Note Off.
     * `emittedKeys` carries the numeric `(channel << 7) | note` offs already
     * emitted by the caller for currently-active notes, scoped by track, so a
     * scheduled re-trigger does not duplicate a release while another track's
     * same note still receives its own release.
     */
    flushAllNotesOff(output: MidiEvent[], nowSamples: number, emittedKeys: Map<string, Set<number>> = new Map()): void {
        for (const event of this.events) {
            if (event.kind.type === 'noteOn' && event.trackId) {
                const key = (event.kind.channel << 7) | event.kind.note;
                let trackKeys = emittedKeys.get(event.trackId);
                if (!trackKeys) {
                    trackKeys = new Set<number>();
                    emittedKeys.set(event.trackId, trackKeys);
                }
                if (trackKeys.has(key)) {
                    continue;
                }
                trackKeys.add(key);
                output.push({
                    timeSamples: nowSamples,
                    trackId: event.trackId,
                    kind: { type: 'noteOff', channel: event.kind.channel, note: event.kind.note },
                });
            }
        }
        this.events = [];
    }

    /** Clear all pending events. */
    clear(): void {
        this.events = [];
    }

    /** Remove one exact scheduled endpoint in place. */
    removeNoteOn(
        trackId: string | undefined,
        channel: number,
        note: number,
        timeSamples: number,
        noteInstanceId?: string
    ): boolean {
        return this.removeNote('noteOn', trackId, channel, note, timeSamples, noteInstanceId);
    }

    removeNoteOff(
        trackId: string | undefined,
        channel: number,
        note: number,
        timeSamples: number,
        noteInstanceId?: string
    ): boolean {
        return this.removeNote('noteOff', trackId, channel, note, timeSamples, noteInstanceId);
    }

    private removeNote(
        kind: 'noteOn' | 'noteOff',
        trackId: string | undefined,
        channel: number,
        note: number,
        timeSamples: number,
        noteInstanceId?: string
    ): boolean {
        for (let index = 0; index < this.events.length; index++) {
            const event = this.events[index]!;
            if (
                event.kind.type === kind &&
                event.trackId === trackId &&
                event.kind.channel === channel &&
                event.kind.note === note &&
                event.timeSamples === timeSamples &&
                (noteInstanceId === undefined || event.noteInstanceId === noteInstanceId)
            ) {
                this.events.splice(index, 1);
                return true;
            }
        }
        return false;
    }

    get size(): number {
        return this.events.length;
    }
}
