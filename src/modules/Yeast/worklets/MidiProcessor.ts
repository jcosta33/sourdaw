/**
 * MidiProcessor interface — the core contract for all Yeast MIDI effect modules.
 *
 * Each processor transforms a stream of MidiEvents, potentially adding, removing,
 * modifying, or retiming events. Processors are chained in a serial rack.
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';

import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';

export type MidiProcessor = {
    readonly id: string;
    readonly name: string;

    /** Process a block of MIDI events. Append output events to `output`. */
    processMidi(input: readonly MidiEvent[], output: MidiEvent[], transport: TransportInfo): void;

    /** Reset all internal state (on transport stop, panic, etc.). */
    reset(): void;

    /** Set bypass state. When bypassed, events pass through unmodified. */
    setBypassed(bypassed: boolean): void;

    /** Whether this processor is currently bypassed. */
    isBypassed(): boolean;

    /** Set the route whose block is currently being processed. */
    setTrackId?(trackId: string): void;

    /** Set a named parameter. */
    setParam(name: string, value: number): void;

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

    /** Drain all events whose time falls within [start, end). Returns sorted. */
    drainRange(startSamples: number, endSamples: number): MidiEvent[] {
        const drained: MidiEvent[] = [];
        this.drainRangeInto(startSamples, endSamples, drained);
        return drained;
    }

    /**
     * Drain all events whose time falls within [start, end) into `out` (which
     * must be empty on entry), sorting the result in place. Partitions
     * `this.events` in place to avoid the `remaining` array allocation in the
     * original `drainRange` (§149.1).
     */
    drainRangeInto(startSamples: number, endSamples: number, out: MidiEvent[]): MidiEvent[] {
        const src = this.events;
        let writeIdx = 0;
        for (let index = 0; index < src.length; index++) {
            const event = src[index]!;
            if (event.timeSamples >= startSamples && event.timeSamples < endSamples) {
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

    get size(): number {
        return this.events.length;
    }
}
