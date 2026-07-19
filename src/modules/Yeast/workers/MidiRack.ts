/**
 * MidiRack — serial pipeline of MidiProcessors.
 *
 * Manages the chain, scheduled event queue, and all-notes-off safety.
 * Called once per audio block with the incoming MIDI events for that block.
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';
import { type YeastPreviewPackedPage } from '../models/YeastPreviewSnapshot';

import { type MidiProcessor, ScheduledEventQueue } from './MidiProcessor';
import { YeastPreviewSidecar } from './YeastPreviewSidecar';

import type { ProcessorType } from '../models/ProcessorCatalog';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

export class MidiRack {
    private processors: MidiProcessor[] = [];
    private processorTypes: Map<string, ProcessorType> = new Map();
    private scheduled = new ScheduledEventQueue();
    // Route-scoped numeric keys preserve same-note voices from different tracks
    // without allocating composite string keys on the block path.
    private activeNotes: Map<string, Map<number, MidiEvent>> = new Map();
    // Scratch buffers reused across blocks to avoid per-processor array
    // allocation (§149.1). Ping-pong between scratchA / scratchB during the
    // processor chain loop. `separateOutput` is the persistent return buffer.
    private scratchA: MidiEvent[] = [];
    private scratchB: MidiEvent[] = [];
    private separateOutput: MidiEvent[] = [];
    private readonly preview: YeastPreviewSidecar;
    private readonly defaultRackId: string | undefined;
    private projectionVersion = 0;

    constructor(rackId?: string) {
        this.defaultRackId = rackId;
        this.preview = new YeastPreviewSidecar();
    }

    /** Add a processor to the end of the chain. */
    addProcessor(processor: MidiProcessor, type?: ProcessorType): void {
        this.processors.push(processor);
        if (type) {
            this.processorTypes.set(processor.id, type);
        }
        this.markTopologyChanged();
    }

    /**
     * Remove a processor by id.
     *
     * Removing a processor mid-playback changes the chain's output, so any note
     * currently sounding may no longer receive its Note Off from the (now reset
     * and detached) processor — e.g. an Arpeggiator's `reset()` drops its
     * scheduled Note Offs and `activeGenerated` set without emitting them. It
     * must emit a Note Off for every currently-active note and clear the
     * tracking, mirroring `allNotesOff`. The offs retain their originating
     * track and are stamped at `nowSamples` (the offs are immediate, not at the
     * original Note On time). Returns the emitted Note Offs so the caller can
     * route them downstream (parity with `allNotesOff`).
     */
    removeProcessor(id: string, nowSamples = 0): MidiEvent[] {
        const output: MidiEvent[] = [];
        const idx = this.processors.findIndex((param) => param.id === id);
        if (idx === -1) {
            return output;
        }
        this.markTopologyChanged();
        const emittedKeys = new Map<string, Set<number>>();
        // Capture active notes BEFORE reset/splice — once the processor is gone
        // these notes would hang with no source to terminate them.
        for (const [trackId, notes] of this.activeNotes) {
            const trackKeys = new Set<number>();
            emittedKeys.set(trackId, trackKeys);
            for (const [key, event] of notes) {
                if (event.kind.type === 'noteOn') {
                    trackKeys.add(key);
                    output.push({
                        timeSamples: nowSamples,
                        trackId,
                        kind: { type: 'noteOff', channel: event.kind.channel, note: event.kind.note },
                    });
                }
            }
        }
        this.activeNotes.clear();
        this.scheduled.flushAllNotesOff(output, nowSamples, emittedKeys);
        this.processors[idx]!.reset();
        this.processors.splice(idx, 1);
        this.processorTypes.delete(id);
        return output;
    }

    /** Reconcile the Worker-owned chain to the latest serializable projection. */
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
            let current = this.processors.find((processor) => processor.id === desired.id);
            if (!current) {
                current = createProcessor(desired.type, desired.id);
                this.addProcessor(current, desired.type);
            }
            current.replaceParams(desired.params);
            this.setProcessorBypass(desired.id, desired.bypassed);
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
        if (fromIdx === toIdx) {
            return;
        }
        const [proc] = this.processors.splice(fromIdx, 1);
        this.processors.splice(toIdx, 0, proc!);
        this.markTopologyChanged();
    }

    /** Process a block of MIDI events through the chain. */
    processBlock(
        inputEvents: readonly MidiEvent[],
        blockStartSamples: number,
        blockEndSamples: number,
        transport: TransportInfo,
        trackId: string,
        previewEnabled = false,
        rackId = this.defaultRackId ?? trackId,
        routeId = trackId,
        captureEpoch = previewEnabled ? 1 : 0
    ): MidiEvent[] {
        this.preview.beginBlock(
            previewEnabled,
            blockStartSamples,
            blockEndSamples,
            transport,
            rackId,
            routeId,
            trackId,
            captureEpoch,
            this.projectionVersion
        );
        const preview = previewEnabled ? this.preview : undefined;
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
        this.scheduled.drainRangeInto(blockStartSamples, blockEndSamples, current0, trackId);

        // 2. Merge with input events.
        for (let index = 0; index < inputEvents.length; index++) {
            const event = inputEvents[index]!;
            event.trackId = trackId;
            current0.push(event);
        }
        current0.sort((alpha, b) => alpha.timeSamples - b.timeSamples);

        // 3. Run through processor chain — ping-pong between scratchA/scratchB
        // so each hop reuses the same two buffers (§149.1).
        let input: MidiEvent[] = current0;
        let output: MidiEvent[] = this.scratchB;
        for (const processor of this.processors) {
            processor.setTrackId?.(trackId);
            if (processor.isBypassed()) {
                preview?.recordProcessorEvents(input, processor.id, true, false);
                preview?.recordProcessorProvenance(processor.id, true, false, 0);
                continue;
            }
            output.length = 0;
            preview?.beginProcessorTransformation();
            try {
                processor.processMidi(input, output, transport, preview);
                preview?.finishProcessorTransformation(output);
                preview?.beginProcessorEvents();
                let previewEventCount = 0;
                for (const event of output) {
                    event.trackId ??= trackId;
                    if (preview && event.kind.type === 'noteOn') {
                        previewEventCount += 1;
                    }
                    preview?.recordProcessorEvent(event, processor.id, false, false);
                }
                preview?.recordProcessorProvenance(processor.id, false, false, previewEventCount);
            } catch {
                // A throwing processor must not abort the rest of the chain (or
                // the block). Treat it as a transparent bypass for this block:
                // skip the buffer swap so the upstream events flow through
                // unchanged. The happy path takes no exception, so try/catch adds
                // no per-block allocation on the audio thread.
                preview?.cancelProcessorTransformation();
                preview?.recordProcessorEvents(input, processor.id, false, true);
                preview?.recordProcessorProvenance(processor.id, false, true, 0);
                continue;
            }
            const tmp = input;
            input = output;
            output = tmp;
        }
        const current = input;

        // 4. Sort final output
        current.sort((alpha, b) => alpha.timeSamples - b.timeSamples);
        for (const event of current) {
            event.trackId ??= trackId;
        }
        preview?.recordTerminalEvents(current, trackId);

        // 5. Track active notes for panic with route-scoped numeric keys.
        for (const event of current) {
            if (event.kind.type === 'noteOn') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const eventTrackId = event.trackId ?? trackId;
                let trackNotes = this.activeNotes.get(eventTrackId);
                if (!trackNotes) {
                    trackNotes = new Map<number, MidiEvent>();
                    this.activeNotes.set(eventTrackId, trackNotes);
                }
                trackNotes.set(key, event);
            } else if (event.kind.type === 'noteOff') {
                const key = (event.kind.channel << 7) | event.kind.note;
                const eventTrackId = event.trackId ?? trackId;
                const trackNotes = this.activeNotes.get(eventTrackId);
                trackNotes?.delete(key);
                if (trackNotes?.size === 0) {
                    this.activeNotes.delete(eventTrackId);
                }
            }
        }

        // 6. Separate: events in this block go to output, future events go to
        // the scheduled queue. `separateOutput` is a persistent scratch buffer;
        // the caller consumes it synchronously before the next processBlock
        // call (the Yeast Worker posts it via structuredClone, and the
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

    takePreviewPage(): YeastPreviewPackedPage | undefined {
        return this.preview.takePage();
    }

    releasePreviewPage(page: YeastPreviewPackedPage): void {
        this.preview.releasePage(page);
    }

    releasePreview(rackId: string, routeId: string, trackId: string, captureEpoch: number): void {
        this.preview.releaseRoute(rackId, routeId, trackId, captureEpoch);
    }

    /** Panic: send Note Off for all active notes. */
    allNotesOff(nowSamples: number): MidiEvent[] {
        const output: MidiEvent[] = [];
        this.preview.resetAll();
        // Track (channel<<7)|note of every off emitted per origin so each
        // sounding/scheduled note gets exactly one Note Off.
        const emittedKeys = new Map<string, Set<number>>();

        // Kill tracked active notes
        for (const [trackId, notes] of this.activeNotes) {
            const trackKeys = new Set<number>();
            emittedKeys.set(trackId, trackKeys);
            for (const [key, event] of notes) {
                if (event.kind.type === 'noteOn') {
                    trackKeys.add(key);
                    output.push({
                        timeSamples: nowSamples,
                        trackId,
                        kind: { type: 'noteOff', channel: event.kind.channel, note: event.kind.note },
                    });
                }
            }
        }
        this.activeNotes.clear();

        // Flush scheduled queue, de-duped against the active-note offs above.
        this.scheduled.flushAllNotesOff(output, nowSamples, emittedKeys);

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

    /** Execute one typed command on the Worker-owned processor instance. */
    executeCommand(command: YeastProcessorCommand): boolean {
        const processor = this.processors.find((entry) => entry.id === command.processorId);
        if (!processor || this.processorTypes.get(command.processorId) !== 'chordMemory') {
            return false;
        }
        return processor.executeCommand?.(command) ?? false;
    }

    /** Toggle bypass on a specific processor. */
    setProcessorBypass(processorId: string, bypassed: boolean): void {
        const proc = this.processors.find((param) => param.id === processorId);
        if (!proc || proc.isBypassed() === bypassed) {
            return;
        }
        proc.setBypassed(bypassed);
        this.markTopologyChanged();
    }

    private markTopologyChanged(): void {
        this.projectionVersion += 1;
        this.preview.invalidatePending();
    }
}
