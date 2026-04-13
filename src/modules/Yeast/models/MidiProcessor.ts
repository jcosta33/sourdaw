/**
 * MidiProcessor interface — the core contract for all Yeast MIDI effect modules.
 *
 * Each processor transforms a stream of MidiEvents, potentially adding, removing,
 * modifying, or retiming events. Processors are chained in a serial rack.
 */

import { type MidiEvent, type TransportInfo } from './MidiEvent';

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
    sourceId: number;
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
        for (let i = 0; i < src.length; i++) {
            const e = src[i]!;
            if (e.timeSamples >= startSamples && e.timeSamples < endSamples) {
                out.push(e);
            } else {
                src[writeIdx++] = e;
            }
        }
        src.length = writeIdx;
        out.sort((a, b) => a.timeSamples - b.timeSamples);
        return out;
    }

    /** Flush all scheduled events as immediate Note Offs. */
    flushAllNotesOff(output: MidiEvent[], nowSamples: number): void {
        for (const e of this.events) {
            if (e.kind.type === 'noteOn') {
                output.push({
                    timeSamples: nowSamples,
                    kind: { type: 'noteOff', channel: e.kind.channel, note: e.kind.note },
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
