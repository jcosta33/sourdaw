/**
 * MidiProcessor interface — the core contract for all Yeast MIDI effect modules.
 *
 * Each processor transforms a stream of MidiEvents, potentially adding, removing,
 * modifying, or retiming events. Processors are chained in a serial rack.
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';

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

    /** Set a named parameter. */
    setParam(name: string, value: number): void;

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
     * Each distinct (channel, note) yields exactly one Note Off. `emittedKeys`
     * (numeric key `(channel << 7) | note`) carries the offs already emitted by
     * the caller for currently-active notes, so a scheduled re-trigger of a note
     * that is already sounding does not produce a duplicate off; it also guards
     * against two scheduled Note Ons for the same (channel, note) double-emitting.
     * Keys for newly emitted offs are added to the set.
     */
    flushAllNotesOff(output: MidiEvent[], nowSamples: number, emittedKeys: Set<number> = new Set()): void {
        for (const event of this.events) {
            if (event.kind.type === 'noteOn') {
                const key = (event.kind.channel << 7) | event.kind.note;
                if (emittedKeys.has(key)) {
                    continue;
                }
                emittedKeys.add(key);
                output.push({
                    timeSamples: nowSamples,
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
