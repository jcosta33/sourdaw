/**
 * MidiRack — serial pipeline of MidiProcessors.
 *
 * Manages the chain, scheduled event queue, and all-notes-off safety.
 * Called once per audio block with the incoming MIDI events for that block.
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';
import { type MidiProcessor, ScheduledEventQueue } from '../models/MidiProcessor';

export class MidiRack {
    private processors: MidiProcessor[] = [];
    private scheduled = new ScheduledEventQueue();
    private activeNotes: Map<string, MidiEvent> = new Map();

    /** Add a processor to the end of the chain. */
    addProcessor(processor: MidiProcessor): void {
        this.processors.push(processor);
    }

    /** Remove a processor by id. */
    removeProcessor(id: string): void {
        const idx = this.processors.findIndex((p) => p.id === id);
        if (idx !== -1) {
            this.processors[idx]!.reset();
            this.processors.splice(idx, 1);
        }
    }

    /** Reorder: move processor from fromIdx to toIdx. */
    reorder(fromIdx: number, toIdx: number): void {
        if (fromIdx < 0 || fromIdx >= this.processors.length) return;
        if (toIdx < 0 || toIdx >= this.processors.length) return;
        const [proc] = this.processors.splice(fromIdx, 1);
        this.processors.splice(toIdx, 0, proc!);
    }

    /** Process a block of MIDI events through the chain. */
    processBlock(
        inputEvents: readonly MidiEvent[],
        blockStartSamples: number,
        blockEndSamples: number,
        transport: TransportInfo,
    ): MidiEvent[] {
        // 1. Drain scheduled events for this block
        const scheduled = this.scheduled.drainRange(blockStartSamples, blockEndSamples);

        // 2. Merge with input events, sorted by time
        let current: MidiEvent[] = [...inputEvents, ...scheduled];
        current.sort((a, b) => a.timeSamples - b.timeSamples);

        // 3. Run through processor chain
        for (const processor of this.processors) {
            if (processor.isBypassed()) continue;

            const output: MidiEvent[] = [];
            processor.processMidi(current, output, transport);
            current = output;
        }

        // 4. Sort final output
        current.sort((a, b) => a.timeSamples - b.timeSamples);

        // 5. Track active notes for panic
        for (const event of current) {
            const key = `${event.kind.type === 'noteOn' || event.kind.type === 'noteOff' ? event.kind.channel : 0}:${event.kind.type === 'noteOn' || event.kind.type === 'noteOff' ? event.kind.note : 0}`;
            if (event.kind.type === 'noteOn') {
                this.activeNotes.set(key, event);
            } else if (event.kind.type === 'noteOff') {
                this.activeNotes.delete(key);
            }
        }

        // 6. Separate: events in this block go to output, future events go to scheduled queue
        const output: MidiEvent[] = [];
        for (const event of current) {
            if (event.timeSamples < blockEndSamples) {
                output.push(event);
            } else {
                this.scheduled.push(event);
            }
        }

        return output;
    }

    /** Panic: send Note Off for all active notes. */
    allNotesOff(nowSamples: number): MidiEvent[] {
        const output: MidiEvent[] = [];

        // Kill tracked active notes
        for (const [, event] of this.activeNotes) {
            if (event.kind.type === 'noteOn') {
                output.push({
                    timeSamples: nowSamples,
                    kind: { type: 'noteOff', channel: event.kind.channel, note: event.kind.note },
                });
            }
        }
        this.activeNotes.clear();

        // Flush scheduled queue
        this.scheduled.flushAllNotesOff(output, nowSamples);
        this.scheduled.clear();

        // Reset all processors
        for (const processor of this.processors) {
            processor.reset();
        }

        return output;
    }

    /** Get the list of processor IDs in order. */
    getProcessorIds(): string[] {
        return this.processors.map((p) => p.id);
    }

    /** Get processor names for UI. */
    getProcessorNames(): Array<{ id: string; name: string; bypassed: boolean }> {
        return this.processors.map((p) => ({
            id: p.id,
            name: p.name,
            bypassed: p.isBypassed(),
        }));
    }

    /** Set a parameter on a specific processor. */
    setProcessorParam(processorId: string, name: string, value: number): void {
        const proc = this.processors.find((p) => p.id === processorId);
        proc?.setParam(name, value);
    }

    /** Toggle bypass on a specific processor. */
    setProcessorBypass(processorId: string, bypassed: boolean): void {
        const proc = this.processors.find((p) => p.id === processorId);
        proc?.setBypassed(bypassed);
    }
}
