import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import {
    YEAST_PREVIEW_BYPASSED_FLAG,
    YEAST_PREVIEW_CAPACITY,
    YEAST_PREVIEW_CLOSED_PHASE,
    YEAST_PREVIEW_FAILED_FLAG,
    YEAST_PREVIEW_OPEN_PHASE,
    YEAST_PREVIEW_REALIZED_FLAG,
} from '../../models/YeastPreviewSnapshot';
import { MidiRack } from '../MidiRack';
import { YeastPreviewSidecar } from '../YeastPreviewSidecar';

import type { YeastPreviewPackedPage } from '../../models/YeastPreviewSnapshot';
import type { MidiProcessor } from '../MidiProcessor';
import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

const SAMPLES_PER_BEAT = 22050; // 44100 Hz * 60 / 120 bpm

const transport: TransportInfo = {
    isPlaying: true,
    ppqPosition: 0,
    bpm: 120,
    sampleRate: 44100,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

function noteOn(timeSamples: number, note: number, trackId?: string): MidiEvent {
    return { timeSamples, kind: { type: 'noteOn', channel: 0, note, velocity: 100 }, ...(trackId ? { trackId } : {}) };
}

type PreviewRecord = {
    eventId: number;
    pitch: number;
    velocity: number;
    beatTime: number;
    durationBeats: number;
    probability: number | null;
    realized: boolean;
    bypassed: boolean;
    failed: boolean;
    processorId: string | null;
    phase: 'open' | 'closed' | 'invalid';
    trackId: string;
};

type PreviewBlock = {
    records: PreviewRecord[];
    provenanceCount: number;
    droppedEvents: number;
    reset: boolean;
    count: number;
};

function decodePage(page: YeastPreviewPackedPage): PreviewBlock {
    const phase = (value: number): 'open' | 'closed' | 'invalid' => {
        if (value === YEAST_PREVIEW_OPEN_PHASE) {
            return 'open';
        }
        if (value === YEAST_PREVIEW_CLOSED_PHASE) {
            return 'closed';
        }
        return 'invalid';
    };
    const records: PreviewRecord[] = Array.from({ length: page.count }, (_, index) => ({
        eventId: page.eventId[index]!,
        pitch: page.pitch[index]!,
        velocity: page.velocity[index]!,
        beatTime: page.beatTime[index]!,
        durationBeats: page.durationBeats[index]!,
        // NaN encodes a null probability in the packed page.
        probability: Number.isNaN(page.probability[index]!) ? null : page.probability[index]!,
        realized: (page.flags[index]! & YEAST_PREVIEW_REALIZED_FLAG) !== 0,
        bypassed: (page.flags[index]! & YEAST_PREVIEW_BYPASSED_FLAG) !== 0,
        failed: (page.flags[index]! & YEAST_PREVIEW_FAILED_FLAG) !== 0,
        processorId: page.processorId[index] || null,
        phase: phase(page.phase[index]!),
        trackId: page.trackIds[index]!,
    }));
    return {
        records,
        provenanceCount: page.provenanceCount,
        droppedEvents: page.droppedEvents,
        reset: page.reset,
        count: page.count,
    };
}

/** Run a single preview-enabled block on a fresh rack and return the decoded page. */
function runBlock(rack: MidiRack, events: readonly MidiEvent[], blockStart = 0, blockEnd = 128): PreviewBlock | null {
    rack.processBlock(events, blockStart, blockEnd, transport, 'track-1', true);
    const page = rack.takePreviewPage();
    if (!page) {
        return null;
    }
    const decoded = decodePage(page);
    rack.releasePreviewPage(page);
    return decoded;
}

/**
 * Run a preview-enabled block with an explicit route identity (rack/route/track)
 * so distinct routes can be driven against one rack. Returns the decoded page.
 */
function runRouteBlock(
    rack: MidiRack,
    events: readonly MidiEvent[],
    rackId: string,
    routeId: string,
    trackId: string,
    captureEpoch = 1,
    blockStart = 0,
    blockEnd = 128
): PreviewBlock | null {
    rack.processBlock(events, blockStart, blockEnd, transport, trackId, true, rackId, routeId, captureEpoch);
    const page = rack.takePreviewPage();
    if (!page) {
        return null;
    }
    const decoded = decodePage(page);
    rack.releasePreviewPage(page);
    return decoded;
}

/** Minimal pass-through processor that satisfies the MidiProcessor contract. */
class PassthroughProcessor implements MidiProcessor {
    readonly id: string;
    readonly name = 'Passthrough';
    constructor(id: string) {
        this.id = id;
    }
    processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        _preview?: YeastPreviewDecisionSink
    ): void {
        for (const event of input) {
            output.push(event);
        }
    }
    reset(): void {}
    replaceParams(): void {}
    setBypassed(): void {}
    isBypassed(): boolean {
        return false;
    }
    setParam(): void {}
    latencySamples(): number {
        return 0;
    }
}

/** Records a realized preview decision for each noteOn, then passes it through. */
class DecisionSourceProcessor extends PassthroughProcessor {
    readonly providesPreviewDecisions = true;
    override processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        for (const event of input) {
            output.push(event);
            if (event.kind.type === 'noteOn') {
                preview?.recordDecision(
                    event.timeSamples,
                    SAMPLES_PER_BEAT / 2,
                    event.kind.note,
                    event.kind.velocity,
                    0.75,
                    true,
                    this.id,
                    event.trackId ?? 'track-1',
                    event
                );
            }
        }
    }
}

describe('YeastPreviewSidecar — page capture via MidiRack', () => {
    it('records a noteOn terminal event with computed beat time and pitch', () => {
        const rack = new MidiRack();
        // SAMPLES_PER_BEAT (22050) samples → exactly 1 beat.
        const block = runBlock(rack, [noteOn(SAMPLES_PER_BEAT, 60)]);

        expect(block).not.toBeNull();
        expect(block!.records).toHaveLength(1);
        const record = block!.records[0]!;
        expect(record.pitch).toBe(60);
        expect(record.velocity).toBe(100);
        expect(record.beatTime).toBeCloseTo(1, 5);
        // No decision source → no processorId and no probability.
        expect(record.processorId).toBeNull();
        expect(record.probability).toBeNull();
    });

    it('assigns monotonically increasing eventIds across blocks', () => {
        const rack = new MidiRack();
        const first = runBlock(rack, [noteOn(0, 60)]);
        const second = runBlock(rack, [noteOn(16, 62)], 128, 256);

        expect(first!.records[0]!.eventId).toBe(0);
        expect(second!.records[0]!.eventId).toBe(1);
        expect(second!.records[0]!.eventId).toBeGreaterThan(first!.records[0]!.eventId);
    });

    it('returns null page when capture is disabled', () => {
        const rack = new MidiRack();
        rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-1', false);
        expect(rack.takePreviewPage()).toBeUndefined();
    });

    it('returns null page when the block captured no events on an established route', () => {
        const rack = new MidiRack();
        // Prime the route so the second block is not a reset (reset forces a page).
        runBlock(rack, [noteOn(0, 60)]);
        // Second block with no events: count 0, provenance 0, drops 0, no reset.
        rack.processBlock([], 128, 256, transport, 'track-1', true);
        expect(rack.takePreviewPage()).toBeUndefined();
    });

    it('drops terminal events past capacity instead of corrupting the page', () => {
        const rack = new MidiRack();
        const overflow = Array.from({ length: YEAST_PREVIEW_CAPACITY + 1 }, (_, index) => noteOn(index, 60));
        const block = runBlock(rack, overflow);

        // Page capped at capacity; exactly one drop recorded.
        expect(block!.count).toBe(YEAST_PREVIEW_CAPACITY);
        expect(block!.droppedEvents).toBe(1);
    });

    it('records separate provenance slots for distinct processors', () => {
        const rack = new MidiRack();
        rack.addProcessor(new PassthroughProcessor('proc-a'));
        rack.addProcessor(new PassthroughProcessor('proc-b'));
        const block = runBlock(rack, [noteOn(0, 60)]);

        expect(block!.provenanceCount).toBe(2);
    });
});

describe('YeastPreviewSidecar — recordDecision via decision-source processor', () => {
    it('attaches a realized decision to a matching terminal noteOn', () => {
        const rack = new MidiRack();
        rack.addProcessor(new DecisionSourceProcessor('decision-source'));
        const block = runBlock(rack, [noteOn(0, 64)]);

        expect(block!.records).toHaveLength(1);
        const record = block!.records[0]!;
        expect(record.realized).toBe(true);
        expect(record.processorId).toBe('decision-source');
        expect(record.probability).toBeCloseTo(0.75, 5);
        // durationSamples = SAMPLES_PER_BEAT/2 → 0.5 beat.
        expect(record.durationBeats).toBeCloseTo(0.5, 5);
    });

    it('distinguishes a decisioned noteOn from a bare noteOn by processorId and probability', () => {
        const rackWithDecision = new MidiRack();
        rackWithDecision.addProcessor(new DecisionSourceProcessor('src'));
        const withDecision = runBlock(rackWithDecision, [noteOn(0, 60)]);

        const rackWithout = new MidiRack();
        const withoutDecision = runBlock(rackWithout, [noteOn(0, 60)]);

        // The decisioned record carries a processorId and probability; bare does not.
        expect(withDecision!.records[0]!.processorId).toBe('src');
        expect(withDecision!.records[0]!.probability).toBeCloseTo(0.75, 5);
        expect(withoutDecision!.records[0]!.processorId).toBeNull();
        expect(withoutDecision!.records[0]!.probability).toBeNull();
    });

    it('records a null probability as NaN in the packed page', () => {
        // Custom decision source that records null probability.
        const rack = new MidiRack();
        rack.addProcessor(
            new (class extends PassthroughProcessor {
                readonly providesPreviewDecisions = true;
                constructor() {
                    super('null-prob');
                }
                override processMidi(
                    input: readonly MidiEvent[],
                    output: MidiEvent[],
                    _t: TransportInfo,
                    preview?: YeastPreviewDecisionSink
                ): void {
                    for (const event of input) {
                        output.push(event);
                        if (event.kind.type === 'noteOn') {
                            preview?.recordDecision(
                                event.timeSamples,
                                0,
                                event.kind.note,
                                event.kind.velocity,
                                null,
                                true,
                                this.id,
                                event.trackId ?? 'track-1',
                                event
                            );
                        }
                    }
                }
            })()
        );
        const block = runBlock(rack, [noteOn(0, 60)]);

        expect(block!.records[0]!.probability).toBeNull();
        expect(block!.records[0]!.realized).toBe(true);
    });
});

describe('YeastPreviewSidecar — route lifecycle', () => {
    it('flags a route reset when processor topology changes', () => {
        const rack = new MidiRack();
        runBlock(rack, [noteOn(0, 60)]);
        // Adding a processor bumps projectionVersion via markTopologyChanged.
        rack.addProcessor(new PassthroughProcessor('topo-change'));
        const block = runBlock(rack, [noteOn(0, 60)]);

        expect(block!.reset).toBe(true);
    });

    it('does not flag reset when projectionVersion is unchanged', () => {
        const rack = new MidiRack();
        runBlock(rack, [noteOn(0, 60)]);
        const block = runBlock(rack, [noteOn(0, 60)]);

        expect(block!.reset).toBe(false);
    });

    it('flags reset on the first block for a fresh route', () => {
        const rack = new MidiRack();
        // First-ever block on a route → projectionVersion mismatch (route had -1).
        const block = runBlock(rack, [noteOn(0, 60)]);
        expect(block!.reset).toBe(true);
    });
});

describe('YeastPreviewSidecar — multi-route capture and eviction', () => {
    it('captures independent records per route and tags each with its route id', () => {
        const rack = new MidiRack();
        const a = runRouteBlock(rack, [noteOn(0, 60)], 'rack-1', 'route-a', 'track-a');
        const b = runRouteBlock(rack, [noteOn(0, 62)], 'rack-1', 'route-b', 'track-b');

        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a!.records[0]!.pitch).toBe(60);
        expect(a!.records[0]!.trackId).toBe('track-a');
        expect(b!.records[0]!.pitch).toBe(62);
        expect(b!.records[0]!.trackId).toBe('track-b');
    });

    it('reuses an evicted route slot (LRU) when more routes than capacity open', () => {
        const rack = new MidiRack();
        // Open CAPACITY+1 distinct routes. The sidecar evicts the least-recently-
        // used route to make room; capture must keep working without overflow.
        for (let index = 0; index <= YEAST_PREVIEW_CAPACITY; index++) {
            const block = runRouteBlock(rack, [noteOn(0, 60)], 'rack-1', `route-${index}`, `track-${index}`);
            // Every block must still produce a captured record after eviction.
            expect(block).not.toBeNull();
            expect(block!.records).toHaveLength(1);
        }
    });

    it('releaseRoute retires a matching route so a later re-open is a reset', () => {
        const rack = new MidiRack();
        // Open route-a.
        runRouteBlock(rack, [noteOn(0, 60)], 'rack-1', 'route-a', 'track-a', 7);
        // Explicitly release it (matching captureEpoch 7).
        rack.releasePreview('rack-1', 'route-a', 'track-a', 7);
        // Re-open route-a with a new epoch → first block on a fresh route is a reset.
        const block = runRouteBlock(rack, [noteOn(0, 60)], 'rack-1', 'route-a', 'track-a', 8);
        expect(block).not.toBeNull();
        expect(block!.reset).toBe(true);
    });
});

describe('YeastPreviewSidecar — queued preview events', () => {
    it('captures an event whose timeSamples fall within the block window', () => {
        const rack = new MidiRack();
        // Prime the route so the first block is not a reset.
        runBlock(rack, [noteOn(10, 60)]);
        // Block [128, 256). Event at 200 is within the window.
        const block = runBlock(rack, [noteOn(200, 62)], 128, 256);

        expect(block).not.toBeNull();
        expect(block!.records).toHaveLength(1);
        expect(block!.records[0]!.pitch).toBe(62);
        // 200 samples into a block starting at 128 → offset 72 → 72/22050 beats.
        expect(block!.records[0]!.beatTime).toBeCloseTo(72 / SAMPLES_PER_BEAT, 5);
    });
});

describe('YeastPreviewSidecar — page phase', () => {
    it('marks records as open phase within an active capture block', () => {
        const rack = new MidiRack();
        const block = runBlock(rack, [noteOn(0, 60)]);
        expect(block!.records[0]!.phase).toBe('open');
    });
});

function noteOff(timeSamples: number, note: number, trackId?: string): MidiEvent {
    return {
        timeSamples,
        kind: { type: 'noteOff', channel: 0, note },
        ...(trackId ? { trackId } : {}),
    };
}

describe('YeastPreviewSidecar — noteOff closes a pending note with its true duration', () => {
    it('emits a closed-phase record whose duration spans the on→off beat gap', () => {
        const rack = new MidiRack();
        // Block 1 [0,128): open noteOn at sample 10. Its pending beat time is
        // (10 - blockStart 0) / SAMPLES_PER_BEAT (ppqPosition is 0 in this transport).
        runBlock(rack, [noteOn(10, 60)]);
        // Block 2 [128,256): noteOff at sample 200 closes the pending noteOn.
        // The closed duration is the beat-time gap: off-beat minus on-beat.
        // off-beat = (200 - blockStart 128) / SAMPLES_PER_BEAT.
        const onBeat = 10 / SAMPLES_PER_BEAT;
        const offBeat = (200 - 128) / SAMPLES_PER_BEAT;
        const block = runBlock(rack, [noteOff(200, 60)], 128, 256);

        expect(block).not.toBeNull();
        const closed = block!.records.find((record) => record.phase === 'closed');
        expect(closed).toBeDefined();
        expect(closed!.pitch).toBe(60);
        expect(closed!.realized).toBe(true);
        // duration = off-beat − on-beat.
        expect(closed!.durationBeats).toBeCloseTo(offBeat - onBeat, 5);
    });

    it('drops a noteOff that matches no pending noteOn instead of recording it', () => {
        const rack = new MidiRack();
        runBlock(rack, [noteOn(0, 60)]);
        // A noteOff for a pitch that never opened has no pending match — it must
        // be ignored, not recorded as a spurious closed event.
        const block = runBlock(rack, [noteOff(200, 72)], 128, 256);
        // No closed record for pitch 72; the page (if any) carries no such record.
        const closed72 = block?.records.find((record) => record.pitch === 72 && record.phase === 'closed');
        expect(closed72).toBeUndefined();
    });
});

describe('YeastPreviewSidecar — capacity drops are deferred, not lost', () => {
    it('counts surplus provenance processors as a single dropped event', () => {
        // More distinct processors than the provenance slots fit → one drop per
        // surplus processor (the provenance ring caps at capacity).
        const rack = new MidiRack();
        for (let index = 0; index < YEAST_PREVIEW_CAPACITY + 1; index++) {
            rack.addProcessor(new PassthroughProcessor(`proc-${index}`));
        }
        const block = runBlock(rack, [noteOn(0, 60)]);
        // provenanceCount caps at capacity; the overflow processor is a drop.
        expect(block!.provenanceCount).toBe(YEAST_PREVIEW_CAPACITY);
        expect(block!.droppedEvents).toBeGreaterThanOrEqual(1);
    });
});

describe('YeastPreviewSidecar — direct API guard clauses', () => {
    // These exercise the sidecar's own early-return guards directly, without the
    // MidiRack driver, to cover branches the rack never hits in normal flow.

    it('recordDecision is a no-op before any capture block begins', () => {
        const sidecar = new YeastPreviewSidecar();
        sidecar.recordDecision(0, 100, 60, 100, 0.5, true, 'proc', 'track-1', noteOn(0, 60));
        // No block → takePage undefined (captureRequested stayed false).
        expect(sidecar.takePage()).toBeUndefined();
    });

    it('retainDecisionLineage returns undefined when no transformation is active', () => {
        const sidecar = new YeastPreviewSidecar();
        // beginBlock sets captureRequested but not processorTransformationActive.
        sidecar.beginBlock(true, 0, 128, transport, 'rack-1', 'track-1', 'track-1', 1, 1);
        const token = sidecar.retainDecisionLineage(noteOn(0, 60));
        expect(token).toBeUndefined();
    });

    it('releasePage rejects a foreign page and leaves the live page intact', () => {
        const sidecar = new YeastPreviewSidecar();
        // Populate the live page with a real record via a capture block.
        sidecar.beginBlock(true, 0, 128, transport, 'rack-1', 'track-1', 'track-1', 1, 1);
        sidecar.recordTerminalEvents([noteOn(0, 60)], 'track-1');
        const livePage = sidecar.takePage();
        expect(livePage).toBeDefined();
        expect(livePage!.count).toBe(1);

        // Releasing a foreign page object must NOT clear the live page's data.
        const foreignPage = {} as YeastPreviewPackedPage;
        expect(() => sidecar.releasePage(foreignPage)).not.toThrow();
        // The live page's record count is unchanged.
        expect(livePage!.count).toBe(1);
        sidecar.releasePage(livePage!);
    });
});

/**
 * Shifts each noteOn up by `pitchShift` semitones, then transfers the source
 * note's lineage onto the shifted note. Mirrors Transposer/Harmonizer. The
 * original noteOn is dropped from the output so the page record can only come
 * from the transformed note carrying the decision via lineage transfer.
 *
 * The decision itself must be recorded by an EARLIER processor (e.g.
 * DecisionSourceProcessor): transferDecisionLineage binds against the committed
 * lineage buffer, so the decision has to have been finished before this
 * transformation runs.
 */
class LineageTransferringProcessor extends PassthroughProcessor {
    readonly pitchShift: number;
    constructor(id: string, pitchShift: number) {
        super(id);
        this.pitchShift = pitchShift;
    }
    override processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        for (const event of input) {
            if (event.kind.type !== 'noteOn') {
                output.push(event);
                continue;
            }
            const shifted: MidiEvent = {
                ...event,
                kind: { ...event.kind, note: event.kind.note + this.pitchShift },
            };
            output.push(shifted);
            preview?.transferDecisionLineage(event, shifted);
        }
    }
}

describe('YeastPreviewSidecar — decision lineage transfer', () => {
    it('carries a committed decision onto a transformed note via transferDecisionLineage', () => {
        const rack = new MidiRack();
        // Processor 1 records + commits the decision; processor 2 shifts the note
        // and transfers the lineage, so the terminal record carries the decision
        // metadata (processorId/probability/duration) on the SHIFTED pitch.
        rack.addProcessor(new DecisionSourceProcessor('src'));
        rack.addProcessor(new LineageTransferringProcessor('xfer', 7));
        const block = runBlock(rack, [noteOn(0, 60)]);

        expect(block!.records).toHaveLength(1);
        const record = block!.records[0]!;
        // The record carries the SHIFTED pitch (lineage bound to the transformed note).
        expect(record.pitch).toBe(67);
        // And the decision metadata followed it through the transfer.
        expect(record.processorId).toBe('src');
        expect(record.probability).toBeCloseTo(0.75, 5);
        expect(record.realized).toBe(true);
        // DecisionSourceProcessor records SAMPLES_PER_BEAT/2 → 0.5 beat.
        expect(record.durationBeats).toBeCloseTo(0.5, 5);
    });

    it('drops a noteOn whose lineage was lost instead of emitting a bare record', () => {
        // Saturate the page + decision buffers. Beyond capacity the page records
        // stop; the surplus terminal noteOns are counted as droppedEvents.
        const rack = new MidiRack();
        rack.addProcessor(new DecisionSourceProcessor('src'));
        rack.addProcessor(new LineageTransferringProcessor('xfer', 0));
        const overflow = Array.from({ length: YEAST_PREVIEW_CAPACITY + 2 }, (_, index) => noteOn(index, 60));
        const block = runBlock(rack, overflow);

        // The page caps at capacity and the overflow notes are counted as drops.
        expect(block!.count).toBeLessThanOrEqual(YEAST_PREVIEW_CAPACITY);
        expect(block!.droppedEvents).toBeGreaterThan(0);
    });
});

/**
 * Mirrors NoteRepeater's retain→restore pattern. Must run AFTER the decision is
 * committed by an earlier processor: retainDecisionLineage binds against the
 * committed lineage buffer.
 */
class LineageRetainingProcessor extends PassthroughProcessor {
    override processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        for (const event of input) {
            output.push(event);
            if (event.kind.type !== 'noteOn' || !preview) {
                continue;
            }
            const token = preview.retainDecisionLineage(event, 1);
            if (token !== undefined && token > 0) {
                // Emit a generated repeat one octave up; restore the retained
                // lineage onto it with an explicit (overridden) duration.
                const repeat: MidiEvent = {
                    ...event,
                    kind: { ...event.kind, note: event.kind.note + 12 },
                };
                output.push(repeat);
                preview.restoreDecisionLineage(token, repeat, SAMPLES_PER_BEAT / 4);
            }
        }
    }
}

describe('YeastPreviewSidecar — decision lineage retain/restore/release', () => {
    it('round-trips committed decision metadata through retain/restore', () => {
        const rack = new MidiRack();
        rack.addProcessor(new DecisionSourceProcessor('src'));
        rack.addProcessor(new LineageRetainingProcessor('retain'));
        const block = runBlock(rack, [noteOn(0, 60)]);

        // Two records: the original noteOn (open) and the restored repeat (+12,
        // closed phase, with the retained probability + overridden duration).
        expect(block!.records).toHaveLength(2);
        const repeat = block!.records.find((record) => record.pitch === 72);
        expect(repeat).toBeDefined();
        // The restored note inherits the SOURCE processor id + probability.
        expect(repeat!.processorId).toBe('src');
        expect(repeat!.probability).toBeCloseTo(0.75, 5);
        expect(repeat!.realized).toBe(true);
        // restore used SAMPLES_PER_BEAT/4 → 0.25 beat duration.
        expect(repeat!.durationBeats).toBeCloseTo(0.25, 5);
    });

    it('restoreDecisionLineage is a no-op for a non-noteOn target (guard clause)', () => {
        const sidecar = new YeastPreviewSidecar();
        sidecar.beginBlock(true, 0, 128, transport, 'rack-1', 'track-1', 'track-1', 1, 1);
        sidecar.beginProcessorTransformation();
        // A non-noteOn target must short-circuit without recording anything.
        const noteOff: MidiEvent = { timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 60 } };
        expect(() => sidecar.restoreDecisionLineage(1, noteOff, 100)).not.toThrow();
        sidecar.finishProcessorTransformation([]);
        const page = sidecar.takePage();
        // No terminal noteOn was recorded, so no page (or an empty one).
        expect(page === undefined || page.count === 0).toBe(true);
        if (page) {
            sidecar.releasePage(page);
        }
    });

    it('cancelProcessorTransformation rolls back retained slots freed for re-use', () => {
        const sidecar = new YeastPreviewSidecar();
        sidecar.beginBlock(true, 0, 128, transport, 'rack-1', 'track-1', 'track-1', 1, 1);
        // Transformation 1: record + commit a decision so it lands in the
        // committed lineage buffer that retainDecisionLineage reads from.
        const source = noteOn(0, 60);
        sidecar.beginProcessorTransformation();
        sidecar.recordDecision(0, 100, 60, 100, 0.5, true, 'proc', 'track-1', source);
        sidecar.finishProcessorTransformation([source]);

        // Transformation 2: retain the committed decision, then cancel. Cancel
        // must roll back the retained slot so a third transformation can re-retain
        // the same decision into the same slot pool.
        sidecar.beginProcessorTransformation();
        const token = sidecar.retainDecisionLineage(source, 1);
        expect(token).toBeDefined();
        expect(token).toBeGreaterThan(0);
        sidecar.cancelProcessorTransformation();

        sidecar.beginProcessorTransformation();
        const token2 = sidecar.retainDecisionLineage(source, 1);
        // The rolled-back slot is available again — re-retain succeeds.
        expect(token2).toBeDefined();
        expect(token2).toBeGreaterThan(0);
        sidecar.cancelProcessorTransformation();
    });

    it('releaseDecisionLineage is a no-op for non-positive tokens and stale generations', () => {
        const sidecar = new YeastPreviewSidecar();
        sidecar.beginBlock(true, 0, 128, transport, 'rack-1', 'track-1', 'track-1', 1, 1);
        sidecar.beginProcessorTransformation();
        // Non-positive token → no-op (LOST_LINEAGE_TOKEN / undefined).
        expect(() => sidecar.releaseDecisionLineage(-1)).not.toThrow();
        expect(() => sidecar.releaseDecisionLineage(0)).not.toThrow();
        // A token whose generation does not match any retained slot → no-op.
        expect(() => sidecar.releaseDecisionLineage(999999, 1)).not.toThrow();
        sidecar.cancelProcessorTransformation();
    });
});
