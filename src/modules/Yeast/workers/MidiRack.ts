/**
 * MidiRack — serial pipeline of MidiProcessors.
 *
 * Manages the chain, scheduled event queue, and all-notes-off safety.
 * Called once per audio block with the incoming MIDI events for that block.
 */

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';
import { type YeastPreviewPackedPage } from '../models/YeastPreviewSnapshot';

import { BoundedNoteVoiceQueue } from './BoundedNoteVoiceQueue';
import { type MidiProcessor, ScheduledEventQueue } from './MidiProcessor';
import { YeastPreviewSidecar } from './YeastPreviewSidecar';

import type { ProcessorType } from '../models/ProcessorCatalog';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

type ActiveRackVoice = {
    event: MidiEvent;
    generation: number;
};

export class MidiRack {
    private processors: MidiProcessor[] = [];
    private processorTypes: Map<string, ProcessorType> = new Map();
    private scheduled = new ScheduledEventQueue();
    // Route-scoped numeric keys preserve same-note voices from different tracks
    // without allocating composite string keys on the block path.
    private activeNotes = new BoundedNoteVoiceQueue<ActiveRackVoice>();
    // Scratch buffers reused across blocks to avoid per-processor array
    // allocation (§149.1). Ping-pong between scratchA / scratchB during the
    // processor chain loop. `separateOutput` is the persistent return buffer.
    private scratchA: MidiEvent[] = [];
    private scratchB: MidiEvent[] = [];
    private deferredOutput: MidiEvent[] = [];
    private separateOutput: MidiEvent[] = [];
    private lifecycleOutput: MidiEvent[] = [];
    private readonly preview: YeastPreviewSidecar;
    private readonly defaultRackId: string | undefined;
    private projectionVersion = 0;
    private generation = 0;
    private lastDiscontinuityEpoch: number | undefined;

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
        this.settleGeneration(output, nowSamples);
        this.processors.splice(idx, 1);
        this.processorTypes.delete(id);
        this.markTopologyChanged();
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
        const topologyChanged = !this.topologyMatches(projection);

        if (topologyChanged) {
            this.settleGeneration(hangingOffs, nowSamples);
        }

        for (let index = this.processors.length - 1; index >= 0; index--) {
            const processor = this.processors[index]!;
            const desired = desiredById.get(processor.id);
            const currentType = this.processorTypes.get(processor.id);
            if (!desired || currentType !== desired.type) {
                processor.reset();
                this.processors.splice(index, 1);
                this.processorTypes.delete(processor.id);
            }
        }

        for (const desired of projection) {
            let current = this.processors.find((processor) => processor.id === desired.id);
            if (!current) {
                current = createProcessor(desired.type, desired.id);
                this.processors.push(current);
                this.processorTypes.set(current.id, desired.type);
            }
            current.replaceParams(desired.params);
            current.setBypassed(desired.bypassed);
        }

        for (let targetIndex = 0; targetIndex < projection.length; targetIndex++) {
            const desiredId = projection[targetIndex]!.id;
            const currentIndex = this.processors.findIndex((processor) => processor.id === desiredId);
            if (currentIndex !== -1 && currentIndex !== targetIndex) {
                const [processor] = this.processors.splice(currentIndex, 1);
                this.processors.splice(targetIndex, 0, processor!);
            }
        }

        if (topologyChanged) {
            this.markTopologyChanged();
        }

        return hangingOffs;
    }

    /** Reorder: move processor from fromIdx to toIdx. */
    reorder(fromIdx: number, toIdx: number, nowSamples = 0): MidiEvent[] {
        const output: MidiEvent[] = [];
        if (fromIdx < 0 || fromIdx >= this.processors.length) {
            return output;
        }
        if (toIdx < 0 || toIdx >= this.processors.length) {
            return output;
        }
        if (fromIdx === toIdx) {
            return output;
        }
        this.settleGeneration(output, nowSamples);
        const [proc] = this.processors.splice(fromIdx, 1);
        this.processors.splice(toIdx, 0, proc!);
        this.markTopologyChanged();
        return output;
    }

    /** Process a block of MIDI events through the chain. */
    processOfflineBlock(
        inputEvents: readonly MidiEvent[],
        blockStartSamples: number,
        blockEndSamples: number,
        transport: TransportInfo,
        trackId: string
    ): MidiEvent[] {
        return this.processBlock(
            inputEvents,
            blockStartSamples,
            blockEndSamples,
            transport,
            trackId,
            false,
            trackId,
            trackId,
            0,
            true
        );
    }

    /** Process a realtime block, normalizing every input event to its route track. */
    processBlock(
        inputEvents: readonly MidiEvent[],
        blockStartSamples: number,
        blockEndSamples: number,
        transport: TransportInfo,
        trackId: string,
        previewEnabled = false,
        rackId = this.defaultRackId ?? trackId,
        routeId = trackId,
        captureEpoch = previewEnabled ? 1 : 0,
        preserveInputTrackIds = false
    ): MidiEvent[] {
        const lifecycleOutput = this.lifecycleOutput;
        lifecycleOutput.length = 0;
        const discontinuityEpoch = transport.discontinuityEpoch;
        if (discontinuityEpoch !== undefined) {
            if (this.lastDiscontinuityEpoch !== undefined && this.lastDiscontinuityEpoch !== discontinuityEpoch) {
                this.settleGeneration(lifecycleOutput, blockStartSamples);
            }
            this.lastDiscontinuityEpoch = discontinuityEpoch;
        }
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

        transport.blockStartSamples = blockStartSamples;
        transport.blockEndSamples = blockEndSamples;

        // 1. Release events the chain deferred in an earlier block. A deferred
        // event has already traversed the whole chain; re-entering it at the
        // chain top would process it a second time and let a generator ingest
        // its own output as a fresh held note. Deferred events therefore
        // rejoin this block's OUTPUT, never its input.
        const deferred = this.deferredOutput;
        deferred.length = 0;
        const scheduledTrackId = preserveInputTrackIds ? undefined : trackId;
        this.scheduled.drainRangeInto(blockStartSamples, blockEndSamples, deferred, scheduledTrackId);

        // 2. The chain's input is this block's own input events.
        const current0 = this.scratchA;
        current0.length = 0;
        for (let index = 0; index < inputEvents.length; index++) {
            const event = inputEvents[index]!;
            if (preserveInputTrackIds) {
                event.trackId ??= trackId;
            } else {
                event.trackId = trackId;
            }
            current0.push(event);
        }
        current0.sort((alpha, b) => alpha.timeSamples - b.timeSamples);

        // 3. Run through processor chain — ping-pong between scratchA/scratchB
        // so each hop reuses the same two buffers (§149.1).
        let input: MidiEvent[] = current0;
        let output: MidiEvent[] = this.scratchB;
        for (const processor of this.processors) {
            processor.setTrackId?.(preserveInputTrackIds ? undefined : trackId);
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
                // Processor state may already be mutated when it throws. Fail the
                // whole rack generation: settle its terminal notes, discard every
                // delayed event, and reset every processor and preview route. Keep
                // the upstream buffer as this processor's transparent-bypass output
                // so failure recovery does not undo earlier processors in the chain.
                preview?.cancelProcessorTransformation();
                this.settleGeneration(lifecycleOutput, blockStartSamples);
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
                preview?.recordProcessorEvents(input, processor.id, false, true);
                preview?.recordProcessorProvenance(processor.id, false, true, 0);
                continue;
            }
            const tmp = input;
            input = output;
            output = tmp;
        }
        const current = input;

        // 3b. Merge in the events deferred by earlier blocks (see step 1):
        // downstream of the chain, so they are separated, tracked and previewed
        // exactly like the events this block produced.
        for (const event of deferred) {
            current.push(event);
        }
        deferred.length = 0;

        // 4. Sort final output
        current.sort((alpha, b) => alpha.timeSamples - b.timeSamples);
        for (const event of current) {
            event.trackId ??= trackId;
        }
        preview?.recordTerminalEvents(current, trackId);

        // 5. Separate: events this block contains go to output, events at or
        // beyond `blockEndSamples` are deferred to the block that contains
        // them. This is the single enforcement point for the half-open block
        // contract on `MidiProcessor.processMidi` — a processor that emits
        // past the window (a step landing exactly on the boundary, a swung or
        // ratcheted arp note, a strummed tone, a delayed echo) still reaches
        // the host at its own time and never re-enters the chain.
        // `separateOutput` is a persistent scratch buffer; the caller consumes
        // it synchronously before the next processBlock call (the Yeast Worker
        // posts it via structuredClone, and the main-thread fallback iterates
        // it before returning).
        const finalOutput = this.separateOutput;
        finalOutput.length = 0;
        for (const event of lifecycleOutput) {
            finalOutput.push(event);
        }
        for (const event of current) {
            if (event.timeSamples < blockEndSamples) {
                finalOutput.push(event);
            } else {
                this.scheduled.push(event);
            }
        }

        // 6. Track only events that have actually reached the host. Future
        // events remain inaudible in the scheduled queue and must be dropped,
        // not released, when a generation is reset.
        for (const event of finalOutput) {
            if (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff') {
                continue;
            }
            const key = (event.kind.channel << 7) | event.kind.note;
            const eventTrackId = event.trackId ?? trackId;
            if (event.kind.type === 'noteOn' && event.kind.velocity > 0) {
                this.activeNotes.push(eventTrackId, key, { event, generation: this.generation });
            } else {
                this.activeNotes.shift(eventTrackId, key);
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
        this.settleGeneration(output, nowSamples);
        return output;
    }

    private settleGeneration(output: MidiEvent[], nowSamples: number): void {
        this.preview.resetAll();
        const generation = this.generation;
        this.activeNotes.visit((voice, routeId) => {
            if (voice.generation !== generation || voice.event.kind.type !== 'noteOn' || routeId === undefined) {
                return;
            }
            output.push({
                timeSamples: nowSamples,
                trackId: routeId,
                kind: { type: 'noteOff', channel: voice.event.kind.channel, note: voice.event.kind.note },
            });
        });
        this.activeNotes.clear();
        this.scheduled.clear();

        // Reset all processors
        for (const processor of this.processors) {
            processor.reset();
        }
        if (!Number.isSafeInteger(this.generation) || this.generation >= Number.MAX_SAFE_INTEGER) {
            this.generation = 1;
            return;
        }

        this.generation += 1;
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
    setProcessorBypass(processorId: string, bypassed: boolean, nowSamples = 0): MidiEvent[] {
        const output: MidiEvent[] = [];
        const proc = this.processors.find((param) => param.id === processorId);
        if (!proc || proc.isBypassed() === bypassed) {
            return output;
        }
        this.settleGeneration(output, nowSamples);
        proc.setBypassed(bypassed);
        this.markTopologyChanged();
        return output;
    }

    private topologyMatches(projection: readonly YeastProcessorProjectionItem[]): boolean {
        if (projection.length !== this.processors.length) {
            return false;
        }
        for (let index = 0; index < projection.length; index++) {
            const desired = projection[index]!;
            const current = this.processors[index]!;
            if (
                current.id !== desired.id ||
                this.processorTypes.get(current.id) !== desired.type ||
                current.isBypassed() !== desired.bypassed
            ) {
                return false;
            }
        }
        return true;
    }

    private markTopologyChanged(): void {
        this.projectionVersion += 1;
        this.preview.invalidatePending();
    }
}
