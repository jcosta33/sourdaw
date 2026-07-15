/**
 * MidiRack — serial pipeline of MidiProcessors.
 *
 * Manages the chain, scheduled event queue, and all-notes-off safety.
 * Called once per audio block with the incoming MIDI events for that block.
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';

import { type MidiProcessor, ScheduledEventQueue } from './MidiProcessor';

import type { ProcessorType } from '../models/ProcessorCatalog';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

export class MidiRack {
    private processors: MidiProcessor[] = [];
    private processorTypes: Map<string, ProcessorType> = new Map();
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
    addProcessor(processor: MidiProcessor, type?: ProcessorType): void {
        this.processors.push(processor);
        if (type) {
            this.processorTypes.set(processor.id, type);
        }
    }

    /**
     * Remove a processor by id.
     *
     * Removing a processor mid-playback changes the chain's output, so any note
     * currently sounding may no longer receive its Note Off from the (now reset
     * and detached) processor — e.g. an Arpeggiator's `reset()` drops its
     * scheduled Note Offs and `activeGenerated` set without emitting them.
     * `activeNotes` carries no per-processor attribution, so we conservatively
     * emit a Note Off for every currently-active note and clear the tracking,
     * mirroring `allNotesOff`. The offs are stamped at `nowSamples` (the offs
     * are immediate, not at the original Note On time). Returns the emitted
     * Note Offs so the caller can route them downstream (parity with
     * `allNotesOff`).
     */
    removeProcessor(id: string, nowSamples = 0): MidiEvent[] {
        const output: MidiEvent[] = [];
        const idx = this.processors.findIndex((param) => param.id === id);
        if (idx === -1) {
            return output;
        }
        // Capture active notes BEFORE reset/splice — once the processor is gone
        // these notes would hang with no source to terminate them.
        for (const [, event] of this.activeNotes) {
            if (event.kind.type === 'noteOn') {
                output.push({
                    timeSamples: nowSamples,
                    kind: { type: 'noteOff', channel: event.kind.channel, note: event.kind.note },
                });
            }
        }
        this.activeNotes.clear();
        this.processors[idx]!.reset();
        this.processors.splice(idx, 1);
        this.processorTypes.delete(id);
        return output;
    }

    /** Reconcile the worklet-owned chain to the latest serializable projection. */
    replaceProjection(
        projection: readonly YeastProcessorProjectionItem[],
        createProcessor: (type: ProcessorType, id: string) => MidiProcessor,
        nowSamples = 0
    ): MidiEvent[] {
        const desiredById = new Map(projection.map((processor) => [processor.id, processor]));
        const hangingOffs: MidiEvent[] = [];

        for (const processor of [...this.processors]) {
            const desired = desiredById.get(processor.id);
            const currentType = this.processorTypes.get(processor.id);
            if (!desired || currentType !== desired.type) {
                hangingOffs.push(...this.removeProcessor(processor.id, nowSamples));
            }
        }

        for (const desired of projection) {
            const current = this.processors.find((processor) => processor.id === desired.id);
            if (!current) {
                this.addProcessor(createProcessor(desired.type, desired.id), desired.type);
            }
            this.setProcessorBypass(desired.id, desired.bypassed);
            for (const [name, value] of Object.entries(desired.params)) {
                this.setProcessorParam(desired.id, name, value);
            }
        }

        for (let targetIndex = 0; targetIndex < projection.length; targetIndex++) {
            const desiredId = projection[targetIndex]!.id;
            const currentIndex = this.processors.findIndex((processor) => processor.id === desiredId);
            if (currentIndex !== -1 && currentIndex !== targetIndex) {
                this.reorder(currentIndex, targetIndex);
            }
        }

        return hangingOffs;
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
        // 0. Reject degenerate ranges. With blockEnd < blockStart the [start,end)
        // drain window is empty (drainRangeInto drains nothing) AND the separator
        // (`event.timeSamples < blockEndSamples`) routes every real event into the
        // scheduled queue instead of the output — silently swallowing notes with
        // no error. Treat a degenerate block as "no work": return an empty buffer
        // and leave input events / the scheduled queue untouched.
        if (blockEndSamples < blockStartSamples) {
            this.separateOutput.length = 0;
            return this.separateOutput;
        }

        // 1. Drain scheduled events directly into scratchA — avoids the
        // intermediate `drained` + spread-merge allocation (§149.1).
        const current0 = this.scratchA;
        current0.length = 0;
        this.scheduled.drainRangeInto(blockStartSamples, blockEndSamples, current0);

        // 2. Merge with input events.
        for (let index = 0; index < inputEvents.length; index++) {
            current0.push(inputEvents[index]!);
        }
        current0.sort((alpha, b) => alpha.timeSamples - b.timeSamples);

        // 3. Run through processor chain — ping-pong between scratchA/scratchB
        // so each hop reuses the same two buffers (§149.1).
        let input: MidiEvent[] = current0;
        let output: MidiEvent[] = this.scratchB;
        for (const processor of this.processors) {
            if (processor.isBypassed()) {
                continue;
            }
            output.length = 0;
            try {
                processor.processMidi(input, output, transport);
            } catch {
                // A throwing processor must not abort the rest of the chain (or
                // the block). Treat it as a transparent bypass for this block:
                // skip the buffer swap so the upstream events flow through
                // unchanged. The happy path takes no exception, so try/catch adds
                // no per-block allocation on the audio thread.
                continue;
            }
            const tmp = input;
            input = output;
            output = tmp;
        }
        const current = input;

        // 4. Sort final output
        current.sort((alpha, b) => alpha.timeSamples - b.timeSamples);

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
        // Track (channel<<7)|note of every off emitted so each sounding/scheduled
        // note gets exactly one Note Off — no stray/duplicate offs from a note
        // that is both active and re-scheduled, or scheduled more than once.
        const emittedKeys = new Set<number>();

        // Kill tracked active notes
        for (const [key, event] of this.activeNotes) {
            if (event.kind.type === 'noteOn') {
                emittedKeys.add(key);
                output.push({
                    timeSamples: nowSamples,
                    kind: { type: 'noteOff', channel: event.kind.channel, note: event.kind.note },
                });
            }
        }
        this.activeNotes.clear();

        // Flush scheduled queue, de-duped against the active-note offs above.
        this.scheduled.flushAllNotesOff(output, nowSamples, emittedKeys);
        this.scheduled.clear();

        // Reset all processors
        for (const processor of this.processors) {
            processor.reset();
        }

        return output;
    }

    /** Get the list of processor IDs in order. */
    getProcessorIds(): string[] {
        return this.processors.map((param) => param.id);
    }

    /** Get processor names for UI. */
    getProcessorNames(): Array<{ id: string; name: string; bypassed: boolean }> {
        return this.processors.map((param) => ({
            id: param.id,
            name: param.name,
            bypassed: param.isBypassed(),
        }));
    }

    /** Set a parameter on a specific processor. */
    setProcessorParam(processorId: string, name: string, value: number): void {
        const proc = this.processors.find((param) => param.id === processorId);
        proc?.setParam(name, value);
    }

    /** Toggle bypass on a specific processor. */
    setProcessorBypass(processorId: string, bypassed: boolean): void {
        const proc = this.processors.find((param) => param.id === processorId);
        proc?.setBypassed(bypassed);
    }
}
