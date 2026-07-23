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
