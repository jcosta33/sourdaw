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
    // Numeric key = (channel << 7) | note avoids per-event template-literal
    // string allocation in AudioWorkletGlobalScope (§149.2).
    private activeNotes: Map<number, MidiEvent> = new Map();
    // Scratch buffers reused across blocks to avoid per-processor array
    // allocation (§149.1). Ping-pong between scratchA / scratchB during the
    // processor chain loop. `separateOutput` is the persistent return buffer.
    private scratchA: MidiEvent[] = [];
    private scratchB: MidiEvent[] = [];
    private separateOutput: MidiEvent[] = [];

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
        if (fromIdx < 0 || fromIdx >= this.processors.length) {
            return;
        }
        if (toIdx < 0 || toIdx >= this.processors.length) {
            return;
        }
        const [proc] = this.processors.splice(fromIdx, 1);
        this.processors.splice(toIdx, 0, proc!);
    }

    /** Process a block of MIDI events through the chain. */
    processBlock(
        inputEvents: readonly MidiEvent[],
        blockStartSamples: number,
        blockEndSamples: number,
        transport: TransportInfo
    ): MidiEvent[] {
        // 1. Drain scheduled events directly into scratchA — avoids the
        // intermediate `drained` + spread-merge allocation (§149.1).
        const current0 = this.scratchA;
        current0.length = 0;
        this.scheduled.drainRangeInto(blockStartSamples, blockEndSamples, current0);

        // 2. Merge with input events.
        for (let i = 0; i < inputEvents.length; i++) {
            current0.push(inputEvents[i]!);
        }
        current0.sort((a, b) => a.timeSamples - b.timeSamples);

        // 3. Run through processor chain — ping-pong between scratchA/scratchB
        // so each hop reuses the same two buffers (§149.1).
        let input: MidiEvent[] = current0;
        let output: MidiEvent[] = this.scratchB;
        for (const processor of this.processors) {
            if (processor.isBypassed()) {
                continue;
            }
            output.length = 0;
            processor.processMidi(input, output, transport);
            const tmp = input;
            input = output;
            output = tmp;
        }
        const current = input;

        // 4. Sort final output
        current.sort((a, b) => a.timeSamples - b.timeSamples);

        // 5. Track active notes for panic. Numeric key avoids a per-event
        // template literal allocation in the worklet (§149.2).
        for (const event of current) {
            if (event.kind.type === 'noteOn') {
                const key = (event.kind.channel << 7) | event.kind.note;
                this.activeNotes.set(key, event);
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                this.activeNotes.delete(key);
            }
        }

        // 6. Separate: events in this block go to output, future events go to
        // the scheduled queue. `separateOutput` is a persistent scratch buffer;
        // the caller consumes it synchronously before the next processBlock
        // call (yeastWorkletProcessor posts it via structuredClone, and the
        // main-thread fallback iterates it before returning).
        const finalOutput = this.separateOutput;
        finalOutput.length = 0;
        for (const event of current) {
            if (event.timeSamples < blockEndSamples) {
                finalOutput.push(event);
            } else {
                this.scheduled.push(event);
            }
        }

        return finalOutput;
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
