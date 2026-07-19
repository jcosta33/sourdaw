import { describe, it, expect } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../models/MidiEvent';
import { PROCESSOR_TYPES, type ProcessorType } from '../../models/ProcessorCatalog';
import {
    YEAST_PREVIEW_BYPASSED_FLAG,
    YEAST_PREVIEW_CLOSED_PHASE,
    YEAST_PREVIEW_FAILED_FLAG,
    YEAST_PREVIEW_OPEN_PHASE,
} from '../../models/YeastPreviewSnapshot';
import { type MidiProcessor } from '../MidiProcessor';
import { MidiRack } from '../MidiRack';
import { createProcessor } from '../processorFactory';
import { Arpeggiator } from '../processors/Arpeggiator';
import { ChordGenerator } from '../processors/ChordGenerator';
import { ChordMemory } from '../processors/ChordMemory';
import { Humanizer } from '../processors/Humanizer';
import { NoteFilter } from '../processors/NoteFilter';
import { Transposer } from '../processors/Transposer';

import type { YeastPreviewDecisionSink } from '../YeastPreviewSidecar';

type NoteOffEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOff' }> };
type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };

function isNoteOff(event: MidiEvent): event is NoteOffEvent {
    return event.kind.type === 'noteOff';
}

function isNoteOn(event: MidiEvent): event is NoteOnEvent {
    return event.kind.type === 'noteOn';
}

function previewPhase(value: number): 'open' | 'closed' | 'invalid' {
    if (value === YEAST_PREVIEW_OPEN_PHASE) {
        return 'open';
    }
    if (value === YEAST_PREVIEW_CLOSED_PHASE) {
        return 'closed';
    }
    return 'invalid';
}

function takePreviewBlock(rack: MidiRack) {
    const page = rack.takePreviewPage();
    if (!page) {
        return { records: [], provenance: [], droppedEvents: 0, reset: false };
    }
    const records = Array.from({ length: page.count }, (_, index) => ({
        eventId: page.eventId[index]!,
        rackId: page.rackIds[index]!,
        routeId: page.routeIds[index]!,
        trackId: page.trackIds[index]!,
        projectionVersion: page.projectionVersion,
        phase: previewPhase(page.phase[index]!),
        beatTime: page.beatTime[index]!,
        durationBeats: page.durationBeats[index]!,
        pitch: page.pitch[index]!,
        velocity: page.velocity[index]!,
        probability: Number.isNaN(page.probability[index]!) ? null : page.probability[index]!,
        realized: (page.flags[index]! & 1) !== 0,
        processorId: page.processorId[index] || null,
        bypassed: (page.flags[index]! & YEAST_PREVIEW_BYPASSED_FLAG) !== 0,
        failed: (page.flags[index]! & YEAST_PREVIEW_FAILED_FLAG) !== 0,
    }));
    const provenance = Array.from({ length: page.provenanceCount }, (_, index) => ({
        processorId: page.provenanceProcessorId[index]!,
        eventCount: page.provenanceEventCount[index]!,
        bypassed: (page.provenanceFlags[index]! & YEAST_PREVIEW_BYPASSED_FLAG) !== 0,
        failed: (page.provenanceFlags[index]! & YEAST_PREVIEW_FAILED_FLAG) !== 0,
    }));
    const droppedEvents = page.droppedEvents;
    const reset = page.reset;
    rack.releasePreviewPage(page);
    return { records, provenance, droppedEvents, reset };
}

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

/** Minimal pass-through processor used to drive the rack in tests. */
class PassthroughProcessor implements MidiProcessor {
    readonly id: string;
    readonly name = 'Passthrough';
    private bypassed = false;
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
    setBypassed(b: boolean): void {
        this.bypassed = b;
    }
    isBypassed(): boolean {
        return this.bypassed;
    }
    setParam(): void {}
    latencySamples(): number {
        return 0;
    }
}

/** Processor that always throws inside processMidi (audio-thread fault). */
class ThrowingProcessor extends PassthroughProcessor {
    override processMidi(): void {
        throw new Error('boom');
    }
}

class PreviewProbeProcessor extends PassthroughProcessor {
    receivedPreview = false;

    override processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        this.receivedPreview = preview !== undefined;
        super.processMidi(input, output, _transport, preview);
    }
}

class DropFirstNoteProcessor extends PassthroughProcessor {
    override processMidi(input: readonly MidiEvent[], output: MidiEvent[]): void {
        let dropped = false;
        for (const event of input) {
            if (!dropped && event.kind.type === 'noteOn') {
                dropped = true;
                continue;
            }
            output.push(event);
        }
    }
}

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
                    64,
                    event.kind.note,
                    event.kind.velocity,
                    0.75,
                    true,
                    this.id,
                    event.trackId,
                    event
                );
            }
        }
    }
}

const processorLineageCases = [
    { type: 'arpeggiator', behavior: 'drop' },
    { type: 'chord', behavior: 'fan-out and reorder', params: { strum_ms: 10, strum_direction: 1 } },
    { type: 'scale', behavior: 'one-to-one', params: { root: 0, scale: 0, remap_mode: 0 } },
    { type: 'harmonizer', behavior: 'identity reuse and fan-out' },
    { type: 'transposer', behavior: 'one-to-one', params: { semitones: 1 } },
    { type: 'repeater', behavior: 'identity reuse and fan-out', params: { repeat_count: 1 } },
    { type: 'velocity', behavior: 'one-to-one', params: { mode: 1, fixed_vel: 73 } },
    { type: 'humanizer', behavior: 'one-to-one', params: { timing_sigma_ms: 0, vel_sigma: 0 } },
    { type: 'groove', behavior: 'one-to-one' },
    { type: 'filter', behavior: 'identity reuse' },
    { type: 'ccGenerator', behavior: 'identity reuse' },
    { type: 'chordMemory', behavior: 'fan-out' },
    { type: 'euclidean', behavior: 'identity reuse' },
    { type: 'markov', behavior: 'drop' },
    { type: 'mutation', behavior: 'one-to-one' },
] as const satisfies readonly {
    type: ProcessorType;
    behavior: string;
    params?: Readonly<Record<string, number>>;
}[];

describe('MidiRack', () => {
    it('exports MidiRack', () => {
        expect(MidiRack).toBeDefined();
    });

    describe('removeProcessor (fix #1: hung notes on mid-playback removal)', () => {
        it('emits a Note Off for every note still sounding when a processor is removed', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));

            // Sound two notes through the chain so the rack tracks them as active.
            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 1, note: 64, velocity: 100 } },
                ],
                0,
                128,
                transport,
                'track-a'
            );

            const offs = rack.removeProcessor('p1', 256);
            const offNotes = offs.filter(isNoteOff).map((event) => event.kind.note);
            expect(offNotes.sort()).toEqual([60, 64]);
            // Offs are stamped "now", not the original Note On time.
            for (const off of offs) {
                expect(off.timeSamples).toBe(256);
            }
        });

        it('clears active-note tracking so a later panic does not re-emit the same offs', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                0,
                128,
                transport,
                'track-a'
            );

            const removeOffs = rack.removeProcessor('p1', 200);
            expect(removeOffs.filter(isNoteOff)).toHaveLength(1);

            // No active notes remain, so a panic emits nothing.
            const panicOffs = rack.allNotesOff(300);
            expect(panicOffs).toHaveLength(0);
        });

        it('returns an empty array when the id is unknown (no spurious offs)', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                0,
                128,
                transport,
                'track-a'
            );
            expect(rack.removeProcessor('does-not-exist', 200)).toHaveLength(0);
            // The unknown removal must not clear tracking — a panic still fires.
            expect(rack.allNotesOff(300).filter(isNoteOff)).toHaveLength(1);
        });

        it('invalidates terminal preview notes downstream of a removed processor', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.addProcessor(new PassthroughProcessor('p2'));
            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);
            expect(takePreviewBlock(rack).records).toMatchObject([{ pitch: 60, phase: 'open' }]);

            rack.removeProcessor('p1', 128);
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock(
                [noteOff(128, 60)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-a',
                true
            );

            expect(takePreviewBlock(rack).records).toEqual([]);
        });
    });

    describe('replaceProjection', () => {
        it('reconciles ownership, order, and removal note-offs from one projection', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('arp-1'), 'arpeggiator');
            rack.addProcessor(new PassthroughProcessor('filter-1'), 'filter');
            rack.processBlock(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                0,
                128,
                transport,
                'track-a'
            );

            const offs = rack.replaceProjection(
                [
                    { id: 'filter-1', type: 'filter', bypassed: true, params: {} },
                    { id: 'arp-2', type: 'arpeggiator', bypassed: false, params: {} },
                ],
                (_type, id) => new PassthroughProcessor(id),
                256
            );

            expect(rack.getProcessorIds()).toEqual(['filter-1', 'arp-2']);
            expect(rack.getProcessorNames()).toEqual([
                { id: 'filter-1', name: 'Passthrough', bypassed: true },
                { id: 'arp-2', name: 'Passthrough', bypassed: false },
            ]);
            expect(offs.filter(isNoteOff).map((event) => event.kind.note)).toEqual([60]);
            expect(offs[0]?.timeSamples).toBe(256);
        });

        it('restores removed NoteFilter overrides before projection replacement returns', () => {
            const rack = new MidiRack();
            rack.addProcessor(new NoteFilter('filter-1'), 'filter');
            const createFilter = (_type: ProcessorType, id: string): MidiProcessor => new NoteFilter(id);

            rack.replaceProjection(
                [{ id: 'filter-1', type: 'filter', bypassed: false, params: { note_min: 60 } }],
                createFilter
            );
            expect(rack.processBlock([noteOn(0, 59)], 0, 128, transport, 'track-a')).toHaveLength(0);
            expect(rack.processBlock([noteOff(128, 59)], 128, 256, transport, 'track-a')).toHaveLength(0);

            rack.replaceProjection([{ id: 'filter-1', type: 'filter', bypassed: false, params: {} }], createFilter);

            expect(rack.processBlock([noteOn(256, 59)], 256, 384, transport, 'track-a')).toEqual([
                {
                    timeSamples: 256,
                    trackId: 'track-a',
                    kind: { type: 'noteOn', channel: 0, note: 59, velocity: 100 },
                },
            ]);
        });

        it('retains present overrides, restores omitted keys, and ignores unknown keys', () => {
            const rack = new MidiRack();
            rack.addProcessor(new NoteFilter('filter-1'), 'filter');
            const createFilter = (_type: ProcessorType, id: string): MidiProcessor => new NoteFilter(id);

            rack.replaceProjection(
                [
                    {
                        id: 'filter-1',
                        type: 'filter',
                        bypassed: false,
                        params: { note_min: 60, note_max: 70 },
                    },
                ],
                createFilter
            );
            rack.replaceProjection(
                [
                    {
                        id: 'filter-1',
                        type: 'filter',
                        bypassed: false,
                        params: { note_min: 64, future_parameter: 999 },
                    },
                ],
                createFilter
            );

            const output = rack.processBlock([noteOn(0, 63), noteOn(1, 80)], 0, 128, transport, 'track-a');
            expect(output.map((event) => (event.kind.type === 'noteOn' ? event.kind.note : null))).toEqual([80]);
        });

        it('preserves learned ChordMemory state while replacing parameter overrides', () => {
            const rack = new MidiRack();
            const chordMemory = new ChordMemory('cm-1');
            rack.addProcessor(chordMemory, 'chordMemory');
            const createChordMemory = (_type: ProcessorType, id: string): MidiProcessor => new ChordMemory(id);

            expect(rack.executeCommand({ processorId: 'cm-1', type: 'chordMemory.learn' })).toBe(true);
            rack.processBlock([noteOn(0, 60), noteOn(0, 64), noteOn(0, 67)], 0, 128, transport, 'track-a');
            rack.processBlock([noteOff(128, 60)], 128, 256, transport, 'track-a');
            expect(chordMemory.getStoredCount()).toBe(1);

            rack.replaceProjection(
                [{ id: 'cm-1', type: 'chordMemory', bypassed: false, params: { transpose_mode: 0 } }],
                createChordMemory,
                256
            );
            const recalledBeforeReset = rack
                .processBlock([noteOn(256, 60)], 256, 384, transport, 'track-a')
                .filter(isNoteOn)
                .map((event) => event.kind.note);
            expect(recalledBeforeReset).toEqual([60, 64, 67]);
            rack.processBlock([noteOff(384, 60)], 384, 512, transport, 'track-a');

            rack.replaceProjection(
                [{ id: 'cm-1', type: 'chordMemory', bypassed: false, params: {} }],
                createChordMemory,
                512
            );
            const recalledAfterReset = rack
                .processBlock([noteOn(512, 60)], 512, 640, transport, 'track-a')
                .filter(isNoteOn)
                .map((event) => event.kind.note);

            expect(chordMemory.getStoredCount()).toBe(1);
            expect(chordMemory.isLearning()).toBe(false);
            expect(recalledAfterReset).toEqual([60, 64, 67]);
        });
    });

    describe('one-shot processor commands', () => {
        it('executes learn once and does not replay it during durable projection reconciliation', () => {
            const rack = new MidiRack();
            const chordMemory = new ChordMemory('cm-1');
            rack.addProcessor(chordMemory, 'chordMemory');
            const projection = [
                { id: 'cm-1', type: 'chordMemory' as const, bypassed: false, params: { transpose_mode: 1 } },
            ];

            expect(rack.executeCommand({ processorId: 'cm-1', type: 'chordMemory.learn' })).toBe(true);
            rack.processBlock([noteOn(0, 60), noteOn(0, 64), noteOn(0, 67)], 0, 128, transport, 'track-a');
            rack.processBlock([noteOff(128, 60)], 128, 256, transport, 'track-a');

            expect(chordMemory.getStoredCount()).toBe(1);
            expect(chordMemory.isLearning()).toBe(false);

            rack.replaceProjection(projection, (_type, id) => new ChordMemory(id), 256);

            expect(chordMemory.getStoredCount()).toBe(1);
            expect(chordMemory.isLearning()).toBe(false);
        });

        it('executes clear once without letting later projection updates clear new memory', () => {
            const rack = new MidiRack();
            const chordMemory = new ChordMemory('cm-1');
            rack.addProcessor(chordMemory, 'chordMemory');
            const projection = [
                { id: 'cm-1', type: 'chordMemory' as const, bypassed: false, params: { transpose_mode: 1 } },
            ];

            expect(rack.executeCommand({ processorId: 'cm-1', type: 'chordMemory.learn' })).toBe(true);
            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a');
            rack.processBlock([noteOff(128, 60)], 128, 256, transport, 'track-a');
            expect(chordMemory.getStoredCount()).toBe(1);

            expect(rack.executeCommand({ processorId: 'cm-1', type: 'chordMemory.clear' })).toBe(true);
            expect(chordMemory.getStoredCount()).toBe(0);

            expect(rack.executeCommand({ processorId: 'cm-1', type: 'chordMemory.learn' })).toBe(true);
            rack.processBlock([noteOn(256, 62)], 256, 384, transport, 'track-a');
            rack.processBlock([noteOff(384, 62)], 384, 512, transport, 'track-a');
            expect(chordMemory.getStoredCount()).toBe(1);

            rack.replaceProjection(projection, (_type, id) => new ChordMemory(id), 512);

            expect(chordMemory.getStoredCount()).toBe(1);
        });
    });

    describe('processBlock (fix #2: degenerate block range)', () => {
        it('does not swallow input into the scheduled queue when blockEnd < blockStart', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            const out = rack.processBlock(
                [{ timeSamples: 100, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                200,
                100, // blockEnd < blockStart
                transport,
                'track-a'
            );
            expect(out).toHaveLength(0);
            // The degenerate block must NOT have routed the input into the
            // scheduled queue. A later EMPTY block (no new input) would otherwise
            // resurface a ghost note. With the guard, nothing leaks out.
            const out2 = rack.processBlock([], 0, 1024, transport, 'track-a');
            expect(out2).toHaveLength(0);
        });

        it('still produces output for a normal block (blockEnd > blockStart)', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            const out = rack.processBlock(
                [{ timeSamples: 10, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                0,
                128,
                transport,
                'track-a'
            );
            expect(out.some((event) => event.kind.type === 'noteOn' && event.kind.note === 60)).toBe(true);
        });
    });

    describe('processBlock (fix #4: a throwing processor must not abort the chain)', () => {
        it('captures the terminal rack stream once and transports processor provenance separately', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.addProcessor(new PassthroughProcessor('p2'));

            rack.processBlock([noteOn(0, 60), noteOff(64, 60)], 0, 128, transport, 'track-a', true);

            const page = rack.takePreviewPage();
            expect(page).toBeDefined();
            expect(Reflect.get(page ?? {}, 'provenanceCount')).toBe(2);
            expect(Reflect.get(page ?? {}, 'provenanceProcessorId')).toEqual(expect.arrayContaining(['p1', 'p2']));
            const eventIds: unknown = Reflect.get(page ?? {}, 'eventId');
            expect(eventIds).toBeInstanceOf(Float64Array);
            expect((eventIds as Float64Array)[0]).toBe((eventIds as Float64Array)[1]);
            if (page) {
                rack.releasePreviewPage(page);
            }
        });

        it('captures a down-strum in the same stable scheduled order as audible output', () => {
            const enabledRack = new MidiRack();
            const enabledChord = new ChordGenerator('chord');
            enabledChord.setParam('strum_ms', 10);
            enabledChord.setParam('strum_direction', 1);
            enabledRack.addProcessor(enabledChord, 'chord');
            const disabledRack = new MidiRack();
            const disabledChord = new ChordGenerator('chord');
            disabledChord.setParam('strum_ms', 10);
            disabledChord.setParam('strum_direction', 1);
            disabledRack.addProcessor(disabledChord, 'chord');
            const input = [noteOn(0, 60), noteOff(4096, 60)];

            const audibleWithCapture = enabledRack.processBlock(
                input.map((event) => structuredClone(event)),
                0,
                8192,
                transport,
                'track-a',
                true
            );
            const audibleWithoutCapture = disabledRack.processBlock(
                input.map((event) => structuredClone(event)),
                0,
                8192,
                transport,
                'track-a',
                false
            );
            const audiblePitches = audibleWithCapture.filter(isNoteOn).map((event) => event.kind.note);
            const previewPitches = takePreviewBlock(enabledRack)
                .records.filter((record) => record.phase === 'open')
                .map((record) => record.pitch);

            expect(audibleWithCapture).toEqual(audibleWithoutCapture);
            expect(audiblePitches).toEqual([67, 64, 60]);
            expect(previewPitches).toEqual(audiblePitches);
        });

        it('keeps arpeggiator lineage across duplicate pitches produced by transposition', () => {
            const rack = new MidiRack();
            const arp = new Arpeggiator('arp');
            arp.setParam('mode', 6);
            const transposer = new Transposer('transpose');
            transposer.setParam('semitones', 12);
            rack.addProcessor(arp, 'arpeggiator');
            rack.addProcessor(transposer, 'transposer');
            rack.processBlock([noteOn(0, 126), noteOn(0, 127)], 0, 128, transport, 'track-a', true);
            takePreviewBlock(rack);

            const output = rack.processBlock([], 13230, 13358, { ...transport, ppqPosition: 0.6 }, 'track-a', true);
            const preview = takePreviewBlock(rack).records.filter((record) => record.phase === 'open');

            expect(output.filter(isNoteOn).map((event) => event.kind.note)).toEqual([127, 127]);
            expect(preview).toMatchObject([
                { pitch: 127, processorId: 'arp', realized: true },
                { pitch: 127, processorId: 'arp', realized: true },
            ]);
        });

        it('keeps surviving arpeggiator lineage after humanization and a downstream drop', () => {
            const rack = new MidiRack();
            const arp = new Arpeggiator('arp');
            arp.setParam('mode', 6);
            const humanizer = new Humanizer('human');
            humanizer.setParam('timing_mean_ms', 10);
            humanizer.setParam('timing_sigma_ms', 0);
            humanizer.setParam('vel_sigma', 0);
            rack.addProcessor(arp, 'arpeggiator');
            rack.addProcessor(humanizer, 'humanizer');
            rack.addProcessor(new DropFirstNoteProcessor('drop-first'));
            rack.processBlock([noteOn(0, 60), noteOn(0, 64)], 0, 128, transport, 'track-a', true);
            takePreviewBlock(rack);

            const output = rack.processBlock([], 13230, 14000, { ...transport, ppqPosition: 0.6 }, 'track-a', true);
            const preview = takePreviewBlock(rack).records.filter((record) => record.phase === 'open');

            expect(output.filter(isNoteOn)).toMatchObject([{ timeSamples: 11466, kind: { note: 64 } }]);
            expect(preview).toMatchObject([{ pitch: 64, processorId: 'arp', realized: true }]);
        });

        it.each(processorLineageCases)(
            'keeps terminal preview and audible output aligned through $type ($behavior)',
            (testCase) => {
                const { type } = testCase;
                const params: Readonly<Record<string, number>> = 'params' in testCase ? testCase.params : {};
                const createRack = (): MidiRack => {
                    const rack = new MidiRack();
                    rack.addProcessor(new DecisionSourceProcessor('decision-source'));
                    const processor = createProcessor(type, `subject-${type}`);
                    for (const [name, value] of Object.entries(params)) {
                        processor.setParam(name, value);
                    }
                    if (processor instanceof ChordMemory) {
                        processor.executeCommand({ processorId: processor.id, type: 'chordMemory.learn' });
                        processor.processMidi([noteOn(0, 61), noteOn(0, 65), noteOff(1, 61)], [], transport);
                    }
                    rack.addProcessor(processor, type);
                    return rack;
                };
                const enabledRack = createRack();
                const disabledRack = createRack();
                const testTransport = { ...transport, isPlaying: false };
                const input = [noteOn(0, 61), noteOff(7000, 61)];

                const audibleWithCapture = enabledRack.processBlock(
                    input.map((event) => structuredClone(event)),
                    0,
                    8192,
                    testTransport,
                    'track-a',
                    true
                );
                const audibleWithoutCapture = disabledRack.processBlock(
                    input.map((event) => structuredClone(event)),
                    0,
                    8192,
                    testTransport,
                    'track-a',
                    false
                );
                const audibleNotes = audibleWithCapture.filter(isNoteOn);
                const previewNotes = takePreviewBlock(enabledRack).records.filter((record) => record.phase === 'open');

                expect(audibleWithCapture).toEqual(audibleWithoutCapture);
                expect(previewNotes.map((record) => record.pitch)).toEqual(
                    audibleNotes.map((event) => event.kind.note)
                );
                expect(previewNotes.map((record) => record.velocity)).toEqual(
                    audibleNotes.map((event) => event.kind.velocity)
                );
                expect(previewNotes.map((record) => record.beatTime)).toEqual(
                    audibleNotes.map((event) => event.timeSamples / 22050)
                );
                expect(previewNotes.map((record) => record.processorId)).toEqual(
                    audibleNotes.map(() => 'decision-source')
                );
            }
        );

        it('covers every registered processor in the lineage differential matrix', () => {
            expect(processorLineageCases.map(({ type }) => type)).toEqual(PROCESSOR_TYPES.map(({ type }) => type));
        });

        it('keeps decision lineage for a repeater event drained in a later block', () => {
            const rack = new MidiRack();
            rack.addProcessor(new DecisionSourceProcessor('decision-source'));
            const repeater = createProcessor('repeater', 'repeater');
            repeater.setParam('repeat_count', 1);
            repeater.setParam('rate_denom', 1);
            rack.addProcessor(repeater, 'repeater');

            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);
            takePreviewBlock(rack);
            const output = rack.processBlock(
                [{ timeSamples: 88000, kind: { type: 'cc', channel: 0, cc: 1, value: 64 } }],
                88000,
                97000,
                { ...transport, ppqPosition: 88000 / 22050 },
                'track-a',
                true
            );
            const previewNotes = takePreviewBlock(rack).records.filter((record) => record.phase === 'open');

            expect(output.filter(isNoteOn)).toMatchObject([{ timeSamples: 88200, kind: { note: 60 } }]);
            expect(previewNotes).toMatchObject([
                { pitch: 60, processorId: 'decision-source', probability: 0.75, realized: true },
            ]);
        });

        it('counts terminal overflow once when processor origin scratch reaches capacity', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            const events = Array.from({ length: 600 }, (_, index) => noteOn(0, 36 + (index % 48)));

            rack.processBlock(events, 0, 128, transport, 'track-a', true);

            const page = rack.takePreviewPage();
            expect(page?.count).toBe(512);
            expect(page?.droppedEvents).toBe(88);
            expect(page?.provenanceEventCount[0]).toBe(600);
            if (page) {
                rack.releasePreviewPage(page);
            }
        });

        it('does not pass the preview sidecar into processors while capture is disabled', () => {
            const rack = new MidiRack();
            const processor = new PreviewProbeProcessor('probe');
            rack.addProcessor(processor);

            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', false);

            expect(processor.receivedPreview).toBe(false);
        });

        it('keeps future scheduled events on their originating route', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));

            rack.processBlock([noteOn(192, 60)], 0, 128, transport, 'track-a', true);
            takePreviewBlock(rack);

            const routeBOutput = rack.processBlock(
                [],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-b',
                true
            );
            expect(routeBOutput).toEqual([]);
            takePreviewBlock(rack);
            const routeAOutput = rack.processBlock(
                [],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-a',
                true
            );

            expect(routeAOutput).toMatchObject([{ trackId: 'track-a', kind: { type: 'noteOn', note: 60 } }]);
            expect(takePreviewBlock(rack).records).toMatchObject([
                { rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a', pitch: 60 },
            ]);
        });

        it('encodes processor and bypass provenance on every terminal record', () => {
            const rack = new MidiRack();
            const processor = new PassthroughProcessor('p1');
            processor.setBypassed(true);
            rack.addProcessor(processor);

            rack.processBlock([noteOn(0, 60), noteOff(64, 60)], 0, 128, transport, 'track-a', true);

            const page = rack.takePreviewPage();
            const processorIds: unknown = Reflect.get(page ?? {}, 'processorId');
            expect(processorIds).toBeInstanceOf(Array);
            if (page) {
                expect((processorIds as string[]).slice(0, page.count)).toEqual(['p1', 'p1']);
                expect(page.flags[0]! & YEAST_PREVIEW_BYPASSED_FLAG).toBe(YEAST_PREVIEW_BYPASSED_FLAG);
                expect(page.flags[1]! & YEAST_PREVIEW_BYPASSED_FLAG).toBe(YEAST_PREVIEW_BYPASSED_FLAG);
                rack.releasePreviewPage(page);
            }
        });

        it('publishes an open terminal note at onset before its Note Off arrives', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));

            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);

            const page = rack.takePreviewPage();
            expect(page?.count).toBe(1);
            const eventIds: unknown = Reflect.get(page ?? {}, 'eventId');
            const phases: unknown = Reflect.get(page ?? {}, 'phase');
            expect(eventIds).toBeInstanceOf(Float64Array);
            expect((eventIds as Float64Array)[0]).toBeGreaterThanOrEqual(0);
            expect(phases).toBeInstanceOf(Uint8Array);
            expect((phases as Uint8Array)[0]).toBe(0);
            if (page) {
                rack.releasePreviewPage(page);
            }
        });

        it('keeps pending capture continuity isolated for interleaved track routes', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));

            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);
            takePreviewBlock(rack);
            rack.processBlock([noteOn(0, 67), noteOff(64, 67)], 0, 128, transport, 'track-b', true);
            takePreviewBlock(rack);
            rack.processBlock(
                [noteOff(128, 60)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-a',
                true
            );

            expect(takePreviewBlock(rack).records.map((record) => record.pitch)).toEqual([60]);
        });

        it('invalidates pending notes when capture epoch advances without a disabled block', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true, 'rack-a', 'shared-route', 1);
            expect(takePreviewBlock(rack).records).toMatchObject([{ pitch: 60, phase: 'open' }]);

            rack.processBlock(
                [noteOff(128, 60)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-a',
                true,
                'rack-a',
                'shared-route',
                3
            );

            expect(takePreviewBlock(rack).records).toEqual([]);
        });

        it('invalidates route scope across an A to B to A track rebind', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true, 'rack-a', 'shared-route');
            takePreviewBlock(rack);

            rack.processBlock(
                [noteOn(128, 67), noteOff(192, 67)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-b',
                true,
                'rack-a',
                'shared-route'
            );
            expect(takePreviewBlock(rack).records).toMatchObject([
                { routeId: 'shared-route', trackId: 'track-b', pitch: 67, phase: 'open' },
                { routeId: 'shared-route', trackId: 'track-b', pitch: 67, phase: 'closed' },
            ]);

            rack.processBlock(
                [noteOff(256, 60)],
                256,
                384,
                { ...transport, ppqPosition: 256 / 22050 },
                'track-a',
                true,
                'rack-a',
                'shared-route'
            );

            expect(takePreviewBlock(rack).records).toEqual([]);
        });

        it('reuses route capture storage after 512 complete lifecycles', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));

            for (let index = 0; index < 512; index++) {
                const start = index * 256;
                const routeId = `route-${index}`;
                rack.processBlock(
                    [noteOn(start, 60), noteOff(start + 1, 60)],
                    start,
                    start + 128,
                    { ...transport, ppqPosition: start / 22050 },
                    routeId,
                    true,
                    'rack-a',
                    routeId
                );
                expect(takePreviewBlock(rack).records).toHaveLength(2);
                rack.processBlock(
                    [],
                    start + 128,
                    start + 256,
                    { ...transport, ppqPosition: (start + 128) / 22050 },
                    routeId,
                    false,
                    'rack-a',
                    routeId
                );
            }

            rack.processBlock(
                [noteOn(512 * 256, 72), noteOff(512 * 256 + 1, 72)],
                512 * 256,
                512 * 256 + 128,
                { ...transport, ppqPosition: (512 * 256) / 22050 },
                'replacement-track',
                true,
                'rack-a',
                'replacement-route'
            );

            expect(takePreviewBlock(rack).records).toMatchObject([
                { routeId: 'replacement-route', trackId: 'replacement-track', pitch: 72, phase: 'open' },
                { routeId: 'replacement-route', trackId: 'replacement-track', pitch: 72, phase: 'closed' },
            ]);
        });

        it('invalidates open terminal notes when processor enablement changes', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.addProcessor(new PassthroughProcessor('p2'));
            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);
            takePreviewBlock(rack);

            rack.setProcessorBypass('p1', true);
            rack.processBlock(
                [noteOff(128, 60)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-a',
                true
            );

            expect(takePreviewBlock(rack).records).toEqual([]);
        });

        it('versions a processor reorder and resets downstream terminal capture', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.addProcessor(new PassthroughProcessor('p2'));
            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);
            const beforeReorder = takePreviewBlock(rack);

            rack.reorder(0, 1);
            rack.processBlock(
                [noteOff(128, 60)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-a',
                true
            );

            const afterReorder = takePreviewBlock(rack);
            expect(beforeReorder.records[0]).toMatchObject({ rackId: 'rack-a', phase: 'open' });
            expect(afterReorder.reset).toBe(true);
            expect(afterReorder.records).toEqual([]);
            expect(afterReorder.provenance).toHaveLength(2);
            expect(afterReorder.provenance).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ processorId: 'p1' }),
                    expect.objectContaining({ processorId: 'p2' }),
                ])
            );
        });

        it('drops and accounts capture while the reusable preview page is unavailable', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('upstream'));
            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 91 } },
                    { timeSamples: 64, kind: { type: 'noteOff', channel: 0, note: 60 } },
                ],
                0,
                128,
                transport,
                'track-a',
                true
            );
            const busyPage = rack.takePreviewPage();
            expect(busyPage?.count).toBe(2);

            const output = rack.processBlock(
                [
                    { timeSamples: 128, kind: { type: 'noteOn', channel: 0, note: 62, velocity: 92 } },
                    { timeSamples: 192, kind: { type: 'noteOff', channel: 0, note: 62 } },
                ],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-a',
                true
            );

            expect(output).toHaveLength(2);
            expect(rack.takePreviewPage()).toBeUndefined();
            expect(busyPage?.droppedEvents).toBe(0);
            if (busyPage) {
                rack.releasePreviewPage(busyPage);
            }
            rack.processBlock([], 256, 384, { ...transport, ppqPosition: 256 / 22050 }, 'track-a', true);
            expect(takePreviewBlock(rack).droppedEvents).toBe(1);
        });

        it('pairs notes across real scheduling blocks and response advances using absolute beats', () => {
            const rack = new MidiRack();
            const filter = new NoteFilter('filter-1');
            filter.setBypassed(true);
            rack.addProcessor(filter, 'filter');
            const firstTransport: TransportInfo = {
                ...transport,
                sampleRate: 48000,
                bpm: 120,
                ppqPosition: 4,
            };

            rack.processBlock(
                [{ timeSamples: 12000, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 96 } }],
                0,
                24000,
                firstTransport,
                'track-a',
                true
            );
            expect(takePreviewBlock(rack).records).toMatchObject([
                {
                    phase: 'open',
                    beatTime: 4.5,
                    durationBeats: 0,
                    pitch: 60,
                    velocity: 96,
                },
            ]);

            rack.processBlock(
                [{ timeSamples: 36000, kind: { type: 'noteOff', channel: 0, note: 60 } }],
                24000,
                48000,
                { ...firstTransport, bpm: 60, ppqPosition: 5 },
                'track-a',
                true
            );

            expect(takePreviewBlock(rack).records).toMatchObject([
                { phase: 'closed', beatTime: 4.5, durationBeats: 0.75, pitch: 60, velocity: 96 },
            ]);
        });

        it.each([
            {
                discontinuity: 'seek',
                nextStart: 4096,
                nextEnd: 4224,
                nextTransport: { ...transport, ppqPosition: 10 },
            },
            {
                discontinuity: 'loop',
                nextStart: 128,
                nextEnd: 256,
                nextTransport: {
                    ...transport,
                    ppqPosition: 0,
                    loopEnabled: true,
                    loopStartPpq: 0,
                    loopEndPpq: 4,
                },
            },
        ])('invalidates pending preview notes across a transport $discontinuity', (testCase) => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            const firstTransport = { ...transport, ppqPosition: 4 };
            rack.processBlock([noteOn(0, 60)], 0, 128, firstTransport, 'track-a', true);
            expect(takePreviewBlock(rack).records).toMatchObject([{ pitch: 60, phase: 'open' }]);

            rack.processBlock(
                [
                    noteOff(testCase.nextStart, 60),
                    noteOn(testCase.nextStart + 1, 62),
                    noteOff(testCase.nextStart + 2, 62),
                ],
                testCase.nextStart,
                testCase.nextEnd,
                testCase.nextTransport,
                'track-a',
                true
            );

            expect(takePreviewBlock(rack).records.map((record) => record.pitch)).toEqual([62, 62]);
        });

        it('recovers full preview capacity after allNotesOff invalidates pending notes', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock(
                Array.from({ length: 512 }, (_, index) => noteOn(index, 60)),
                0,
                1024,
                transport,
                'track-a',
                true
            );
            expect(takePreviewBlock(rack).records).toHaveLength(512);

            rack.allNotesOff(1024);
            rack.processBlock(
                [noteOn(1024, 61), noteOff(1025, 61)],
                1024,
                1152,
                { ...transport, ppqPosition: 1024 / 22050 },
                'track-a',
                true
            );

            expect(takePreviewBlock(rack)).toMatchObject({
                records: [
                    { pitch: 61, phase: 'open' },
                    { pitch: 61, phase: 'closed' },
                ],
                droppedEvents: 0,
            });
        });

        it('preserves the actual upstream and bypassed processor decision origins', () => {
            const rack = new MidiRack();
            const bypassed = new NoteFilter('filter-1');
            bypassed.setBypassed(true);
            rack.addProcessor(new PassthroughProcessor('upstream'));
            rack.addProcessor(bypassed);

            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 91 } },
                    { timeSamples: 64, kind: { type: 'noteOff', channel: 0, note: 60 } },
                ],
                0,
                128,
                transport,
                'track-a',
                true
            );

            const preview = takePreviewBlock(rack);
            expect(preview.records).toHaveLength(2);
            expect(preview.records).toMatchObject([
                { processorId: 'filter-1', bypassed: true, failed: false },
                { processorId: 'filter-1', bypassed: true, failed: false },
            ]);
            expect(preview.provenance).toMatchObject([
                { processorId: 'upstream', bypassed: false, failed: false, eventCount: 1 },
                { processorId: 'filter-1', bypassed: true, failed: false, eventCount: 0 },
            ]);
        });

        it('passes events through a throwing processor and keeps downstream processors running', () => {
            const rack = new MidiRack();
            rack.addProcessor(new ThrowingProcessor('thrower'));
            rack.addProcessor(new PassthroughProcessor('downstream'));
            const out = rack.processBlock(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                0,
                128,
                transport,
                'track-a'
            );
            // The note survived the throw and reached the output.
            expect(out.some((event) => event.kind.type === 'noteOn' && event.kind.note === 60)).toBe(true);
        });

        it('reports transparent processor failure against the unchanged upstream events', () => {
            const rack = new MidiRack();
            rack.addProcessor(new ThrowingProcessor('thrower'));
            const input: MidiEvent[] = [
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 91 } },
                { timeSamples: 64, kind: { type: 'noteOff', channel: 0, note: 60 } },
            ];

            const output = rack.processBlock(input, 0, 128, transport, 'track-a', true);

            expect(output).toEqual([
                {
                    timeSamples: 0,
                    trackId: 'track-a',
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 91 },
                },
                {
                    timeSamples: 64,
                    trackId: 'track-a',
                    kind: { type: 'noteOff', channel: 0, note: 60 },
                },
            ]);
            const preview = takePreviewBlock(rack);
            expect(preview.records).toHaveLength(2);
            expect(preview.records[1]).toMatchObject({
                phase: 'closed',
                beatTime: 0,
                pitch: 60,
                velocity: 91,
                probability: null,
                realized: true,
                processorId: 'thrower',
                bypassed: false,
                failed: true,
            });
            expect(preview.records[1]!.durationBeats).toBeCloseTo(64 / 22050, 12);
            expect(preview.provenance).toEqual([
                { processorId: 'thrower', eventCount: 0, bypassed: false, failed: true },
            ]);
        });
    });

    describe('allNotesOff (fix #5: de-dup panic output)', () => {
        it('emits exactly one Note Off per sounding note even when also scheduled', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));

            // Block 1: a note-on lands now (active) and a re-trigger of the SAME
            // note is scheduled in the future (routed to the scheduled queue).
            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
                    { timeSamples: 1000, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
                ],
                0,
                128,
                transport,
                'track-a'
            );

            const offs = rack.allNotesOff(500).filter(isNoteOff);
            const note60Offs = offs.filter((event) => event.kind.note === 60 && event.kind.channel === 0);
            expect(note60Offs).toHaveLength(1); // exactly one, not duplicated
        });

        it('emits exactly one Note Off per distinct scheduled note', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            // Two future Note Ons for the same (channel, note) both land in the queue.
            rack.processBlock(
                [
                    { timeSamples: 1000, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
                    { timeSamples: 2000, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
                ],
                0,
                128,
                transport,
                'track-a'
            );
            const offs = rack.allNotesOff(500).filter(isNoteOff);
            const note67Offs = offs.filter((event) => event.kind.note === 67 && event.kind.channel === 0);
            expect(note67Offs).toHaveLength(1);
        });

        it('emits one Note Off per active note across channels', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 1, note: 60, velocity: 100 } },
                ],
                0,
                128,
                transport,
                'track-a'
            );
            const offs = rack.allNotesOff(500).filter(isNoteOff);
            // Same note number, different channels => two distinct offs.
            expect(offs).toHaveLength(2);
            expect(offs.map((event) => event.kind.channel).sort()).toEqual([0, 1]);
        });

        it('releases the same note once for each originating track', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));

            rack.processBlock(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                0,
                128,
                transport,
                'track-a'
            );
            rack.processBlock(
                [{ timeSamples: 128, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                128,
                256,
                transport,
                'track-b'
            );

            expect(rack.allNotesOff(512).filter(isNoteOff)).toEqual([
                { timeSamples: 512, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
                { timeSamples: 512, trackId: 'track-b', kind: { type: 'noteOff', channel: 0, note: 60 } },
            ]);
        });
    });
});

function noteOn(timeSamples: number, note: number): MidiEvent {
    return { timeSamples, kind: { type: 'noteOn', channel: 0, note, velocity: 100 } };
}

function noteOff(timeSamples: number, note: number): MidiEvent {
    return { timeSamples, kind: { type: 'noteOff', channel: 0, note } };
}
