import { describe, it, expect } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../models/MidiEvent';
import { PROCESSOR_TYPES, type ProcessorType } from '../../models/ProcessorCatalog';
import {
    YEAST_PREVIEW_BYPASSED_FLAG,
    YEAST_PREVIEW_CLOSED_PHASE,
    YEAST_PREVIEW_FAILED_FLAG,
    YEAST_PREVIEW_OPEN_PHASE,
} from '../../models/YeastPreviewSnapshot';
import { MidiRack } from '../MidiRack';
import { createProcessor } from '../processorFactory';
import { Arpeggiator } from '../processors/Arpeggiator';
import { ChordGenerator } from '../processors/ChordGenerator';
import { ChordMemory } from '../processors/ChordMemory';
import { GrooveModule } from '../processors/GrooveModule';
import { Harmonizer } from '../processors/Harmonizer';
import { Humanizer } from '../processors/Humanizer';
import { NoteFilter } from '../processors/NoteFilter';
import { NoteRepeater } from '../processors/NoteRepeater';
import { ScaleQuantizer } from '../processors/ScaleQuantizer';
import { Transposer } from '../processors/Transposer';

import type { YeastProcessorProjectionItem } from '../../models/YeastProcessorProjection';
import type { MidiProcessor } from '../MidiProcessor';
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

/** Pass-through that records every event it is handed, in arrival order. */
class RecordingProcessor extends PassthroughProcessor {
    constructor(
        id: string,
        private readonly seen: MidiEvent[]
    ) {
        super(id);
    }

    override processMidi(input: readonly MidiEvent[], output: MidiEvent[]): void {
        for (const event of input) {
            this.seen.push(event);
            output.push(event);
        }
    }
}

/** Processor that always throws inside processMidi (audio-thread fault). */
class ThrowingProcessor extends PassthroughProcessor {
    override processMidi(): void {
        throw new Error('boom');
    }
}

class StatefulOffThenThrowProcessor extends PassthroughProcessor {
    resetCount = 0;
    private active = false;

    override processMidi(input: readonly MidiEvent[], output: MidiEvent[]): void {
        for (const event of input) {
            if (event.kind.type === 'noteOn') {
                this.active = true;
                output.push({
                    ...event,
                    kind: { ...event.kind, note: event.kind.note + 12 },
                });
            } else if (event.kind.type === 'noteOff' && this.active) {
                this.active = false;
                output.push({
                    ...event,
                    kind: { ...event.kind, note: event.kind.note + 12 },
                });
                throw new Error('boom after mutating the note-off mapping');
            } else {
                output.push(event);
            }
        }
    }

    override reset(): void {
        this.active = false;
        this.resetCount += 1;
    }
}

class DecisionThenThrowProcessor extends PassthroughProcessor {
    override processMidi(
        input: readonly MidiEvent[],
        _output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        const event = input.find(isNoteOn);
        if (event?.kind.type === 'noteOn') {
            preview?.recordDecision(
                event.timeSamples,
                64,
                event.kind.note,
                event.kind.velocity,
                0.25,
                false,
                this.id,
                event.trackId
            );
        }
        throw new Error('boom after preview decision');
    }
}

class RetainAllThenThrowProcessor extends PassthroughProcessor {
    override processMidi(
        input: readonly MidiEvent[],
        _output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        const source = input.find(isNoteOn);
        if (source && preview) {
            for (let index = 0; index < 512; index++) {
                preview.retainDecisionLineage(source);
            }
        }
        throw new Error('boom after retained lineage');
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

class LineageTokenProbeProcessor extends PassthroughProcessor {
    processed = false;
    retainedType: string | undefined;
    retainedToken: number | undefined;

    override processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        this.processed = true;
        for (const event of input) {
            output.push(event);
            if (event.kind.type === 'noteOn') {
                this.retainedToken = preview?.retainDecisionLineage(event);
                this.retainedType = typeof this.retainedToken;
            }
        }
    }
}

class KeepLastNoteProcessor extends PassthroughProcessor {
    override processMidi(input: readonly MidiEvent[], output: MidiEvent[]): void {
        for (let index = input.length - 1; index >= 0; index--) {
            const event = input[index]!;
            if (event.kind.type === 'noteOn') {
                output.push(event);
                return;
            }
        }
    }
}

class RetainedLineageExhaustionProcessor extends PassthroughProcessor {
    override processMidi(
        input: readonly MidiEvent[],
        output: MidiEvent[],
        _transport: TransportInfo,
        preview?: YeastPreviewDecisionSink
    ): void {
        const source = input.find(isNoteOn);
        if (!source || !preview) {
            return;
        }
        let exhaustedToken: number | undefined;
        for (let index = 0; index <= 512; index++) {
            exhaustedToken = preview.retainDecisionLineage(source);
        }
        const target = noteOn(source.timeSamples, source.kind.note);
        output.push(target);
        if (exhaustedToken !== undefined) {
            preview.restoreDecisionLineage(exhaustedToken, target);
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

type NoteSignature = `${'noteOn' | 'noteOff'}:${number}@${number}`;

type VoicePairingCase = {
    name: string;
    create: () => MidiProcessor;
    configureFirst: (processor: MidiProcessor) => void;
    configureSecond: (processor: MidiProcessor) => void;
    expected: readonly [NoteSignature[], NoteSignature[], NoteSignature[], NoteSignature[]];
};

function noteSignatures(events: readonly MidiEvent[]): NoteSignature[] {
    return events.flatMap((event) => {
        if (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff') {
            return [];
        }
        return [`${event.kind.type}:${event.kind.note}@${event.timeSamples}` as const];
    });
}

function createLearnedChordMemory(): ChordMemory {
    const processor = new ChordMemory('voice-pairing');
    const output: MidiEvent[] = [];
    processor.executeCommand({ processorId: processor.id, type: 'chordMemory.learn' });
    processor.processMidi([noteOn(0, 60), noteOn(0, 64), noteOn(0, 67)], output, transport);
    processor.processMidi([noteOff(1, 60)], output, transport);
    processor.reset();
    return processor;
}

const voicePairingCases: readonly VoicePairingCase[] = [
    {
        name: 'ChordGenerator',
        create: () => new ChordGenerator('voice-pairing'),
        configureFirst: (processor) => processor.setParam('chord_type', 0),
        configureSecond: (processor) => processor.setParam('chord_type', 1),
        expected: [
            ['noteOn:60@0', 'noteOn:64@0', 'noteOn:67@0'],
            ['noteOn:60@8000', 'noteOn:63@8000', 'noteOn:67@8000'],
            ['noteOff:60@16000', 'noteOff:64@16000', 'noteOff:67@16000'],
            ['noteOff:60@24000', 'noteOff:63@24000', 'noteOff:67@24000'],
        ],
    },
    {
        name: 'ChordMemory',
        create: createLearnedChordMemory,
        configureFirst: () => undefined,
        configureSecond: (processor) => {
            const chordMemory = processor as ChordMemory;
            const learningOutput: MidiEvent[] = [];
            chordMemory.executeCommand({ processorId: chordMemory.id, type: 'chordMemory.clear' });
            chordMemory.executeCommand({ processorId: chordMemory.id, type: 'chordMemory.learn' });
            chordMemory.processMidi([noteOn(2, 60), noteOn(2, 63), noteOn(2, 67)], learningOutput, transport);
            chordMemory.processMidi([noteOff(3, 60)], learningOutput, transport);
        },
        expected: [
            ['noteOn:60@0', 'noteOn:64@0', 'noteOn:67@0'],
            ['noteOn:60@8000', 'noteOn:63@8000', 'noteOn:67@8000'],
            ['noteOff:60@16000', 'noteOff:64@16000', 'noteOff:67@16000'],
            ['noteOff:60@24000', 'noteOff:63@24000', 'noteOff:67@24000'],
        ],
    },
    {
        name: 'GrooveModule',
        create: () => new GrooveModule('voice-pairing'),
        configureFirst: (processor) => {
            processor.setParam('groove_amount', 1);
            processor.setParam('groove_step_beats', 0.25);
            processor.setParam('groove_slot_count', 16);
            processor.setParam('groove_timing_0', 0);
        },
        configureSecond: (processor) => processor.setParam('groove_timing_1', 0.12),
        expected: [['noteOn:60@0'], ['noteOn:60@8662'], ['noteOff:60@16000'], ['noteOff:60@24662']],
    },
    {
        name: 'Harmonizer',
        create: () => new Harmonizer('voice-pairing'),
        configureFirst: (processor) => processor.setParam('voice0_degrees', 2),
        configureSecond: (processor) => processor.setParam('voice0_degrees', 4),
        expected: [
            ['noteOn:60@0', 'noteOn:64@0'],
            ['noteOn:60@8000', 'noteOn:67@8000'],
            ['noteOff:60@16000', 'noteOff:64@16000'],
            ['noteOff:60@24000', 'noteOff:67@24000'],
        ],
    },
    {
        name: 'Humanizer',
        create: () => new Humanizer('voice-pairing'),
        configureFirst: (processor) => {
            processor.setParam('timing_mean_ms', 0);
            processor.setParam('timing_sigma_ms', 0);
            processor.setParam('vel_sigma', 0);
        },
        configureSecond: (processor) => processor.setParam('timing_mean_ms', 10),
        expected: [['noteOn:60@0'], ['noteOn:60@8441'], ['noteOff:60@16000'], ['noteOff:60@24441']],
    },
    {
        name: 'NoteFilter',
        create: () => new NoteFilter('voice-pairing'),
        configureFirst: (processor) => processor.setParam('note_min', 0),
        configureSecond: (processor) => processor.setParam('note_min', 61),
        expected: [['noteOn:60@0'], [], ['noteOff:60@16000'], []],
    },
    {
        name: 'ScaleQuantizer',
        create: () => new ScaleQuantizer('voice-pairing'),
        configureFirst: (processor) => processor.setParam('transpose', 1),
        configureSecond: (processor) => processor.setParam('transpose', 2),
        expected: [['noteOn:62@0'], ['noteOn:64@8000'], ['noteOff:62@16000'], ['noteOff:64@24000']],
    },
    {
        name: 'Transposer',
        create: () => new Transposer('voice-pairing'),
        configureFirst: (processor) => processor.setParam('semitones', 12),
        configureSecond: (processor) => processor.setParam('semitones', 24),
        expected: [['noteOn:72@0'], ['noteOn:84@8000'], ['noteOff:72@16000'], ['noteOff:84@24000']],
    },
];

describe('MidiRack', () => {
    it('exports MidiRack', () => {
        expect(MidiRack).toBeDefined();
    });

    it('returns forward realtime groove events inside a widened horizon with their paired note-off', () => {
        const rack = new MidiRack('rack-a');
        const groove = new GrooveModule('groove-a');
        groove.setParam('groove_step_beats', 0.25);
        groove.setParam('groove_slot_count', 16);
        groove.setParam('groove_timing_0', 0.2);
        groove.setParam('groove_amount', 0.75);
        rack.addProcessor(groove);
        const realtimeTransport = { ...transport, sampleRate: 48_000, bpm: 120, ppqPosition: -0.3 };

        const noteOnOutput = [...rack.processBlock([noteOn(7328, 60)], 128, 12_129, realtimeTransport, 'track-a')];
        const noteOffOutput = [
            ...rack.processBlock([noteOff(27_200, 60)], 20_000, 32_001, realtimeTransport, 'track-a'),
        ];

        expect(noteOnOutput).toEqual([
            expect.objectContaining({
                timeSamples: 8228,
                kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
            }),
        ]);
        expect(noteOffOutput).toEqual([
            expect.objectContaining({
                timeSamples: 28_100,
                kind: { type: 'noteOff', channel: 0, note: 60 },
            }),
        ]);
    });

    it('keeps a negative realtime groove offset ahead of the live input frame', () => {
        const rack = new MidiRack('rack-a');
        const groove = new GrooveModule('groove-a');
        groove.setParam('groove_step_beats', 0.25);
        groove.setParam('groove_slot_count', 16);
        groove.setParam('groove_timing_0', -0.4);
        groove.setParam('groove_amount', 0.75);
        rack.addProcessor(groove);

        const result = rack.processBlock(
            [noteOn(7328, 60)],
            128,
            12_129,
            { ...transport, sampleRate: 48_000, bpm: 120, ppqPosition: -0.3 },
            'track-a'
        );

        expect(result).toEqual([
            expect.objectContaining({
                timeSamples: 5528,
                kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
            }),
        ]);
        expect(result[0]?.timeSamples).toBeGreaterThan(128);
    });

    describe('overlapping same-key voice pairing', () => {
        for (const testCase of voicePairingCases) {
            it(`pairs ${testCase.name} note-offs with note-ons in FIFO order`, () => {
                const rack = new MidiRack('rack-a');
                const processor = testCase.create();
                rack.addProcessor(processor);

                testCase.configureFirst(processor);
                const firstOn = rack.processBlock(
                    [noteOn(0, 60)],
                    0,
                    4096,
                    { ...transport, discontinuityEpoch: 1 },
                    'track-a',
                    true,
                    'rack-a',
                    'track-a',
                    1
                );
                const firstOnSignatures = noteSignatures(firstOn);
                const firstOnPitches = firstOn.filter(isNoteOn).map((event) => event.kind.note);
                const firstOnPreview = takePreviewBlock(rack);

                testCase.configureSecond(processor);
                const secondOn = rack.processBlock(
                    [noteOn(8000, 60)],
                    8000,
                    12096,
                    { ...transport, ppqPosition: 8000 / 22050, discontinuityEpoch: 1 },
                    'track-a',
                    true,
                    'rack-a',
                    'track-a',
                    1
                );
                const secondOnSignatures = noteSignatures(secondOn);
                const secondOnPitches = secondOn.filter(isNoteOn).map((event) => event.kind.note);
                const secondOnPreview = takePreviewBlock(rack);
                const firstOff = rack.processBlock(
                    [noteOff(16000, 60)],
                    16000,
                    20096,
                    { ...transport, ppqPosition: 16000 / 22050, discontinuityEpoch: 1 },
                    'track-a',
                    true,
                    'rack-a',
                    'track-a',
                    1
                );
                const firstOffSignatures = noteSignatures(firstOff);
                const firstOffPitches = firstOff.filter(isNoteOff).map((event) => event.kind.note);
                const firstOffPreview = takePreviewBlock(rack);
                const secondOff = rack.processBlock(
                    [noteOff(24000, 60)],
                    24000,
                    28096,
                    { ...transport, ppqPosition: 24000 / 22050, discontinuityEpoch: 1 },
                    'track-a',
                    true,
                    'rack-a',
                    'track-a',
                    1
                );
                const secondOffSignatures = noteSignatures(secondOff);
                const secondOffPitches = secondOff.filter(isNoteOff).map((event) => event.kind.note);
                const secondOffPreview = takePreviewBlock(rack);

                expect([firstOnSignatures, secondOnSignatures, firstOffSignatures, secondOffSignatures]).toEqual(
                    testCase.expected
                );
                expect(
                    firstOnPreview.records.filter((record) => record.phase === 'open').map((record) => record.pitch)
                ).toEqual(firstOnPitches);
                expect(
                    secondOnPreview.records.filter((record) => record.phase === 'open').map((record) => record.pitch)
                ).toEqual(secondOnPitches);
                expect(
                    firstOffPreview.records.filter((record) => record.phase === 'closed').map((record) => record.pitch)
                ).toEqual(firstOffPitches);
                expect(
                    secondOffPreview.records.filter((record) => record.phase === 'closed').map((record) => record.pitch)
                ).toEqual(secondOffPitches);
            });
        }
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
        it('settles transformed output before acknowledging a bypass change, independent of preview capture', () => {
            const enabledRack = new MidiRack('rack-a');
            const disabledRack = new MidiRack('rack-a');
            const activeProjection = [
                { id: 'transpose-1', type: 'transposer' as const, bypassed: false, params: { semitones: 12 } },
            ];
            const bypassedProjection = [{ ...activeProjection[0]!, bypassed: true }];
            const factory = (_type: ProcessorType, id: string): MidiProcessor => new Transposer(id);
            enabledRack.replaceProjection(activeProjection, factory);
            disabledRack.replaceProjection(activeProjection, factory);

            const audibleWithPreview = enabledRack.processBlock(
                [noteOn(0, 60)],
                0,
                128,
                { ...transport, discontinuityEpoch: 1 },
                'track-a',
                true,
                'rack-a',
                'track-a',
                1
            );
            const audibleWithoutPreview = disabledRack.processBlock(
                [noteOn(0, 60)],
                0,
                128,
                { ...transport, discontinuityEpoch: 1 },
                'track-a'
            );
            expect(audibleWithPreview).toEqual(audibleWithoutPreview);
            expect(takePreviewBlock(enabledRack).records).toMatchObject([{ phase: 'open', pitch: 72 }]);

            const enabledAck = enabledRack.replaceProjection(bypassedProjection, factory, 128);
            const disabledAck = disabledRack.replaceProjection(bypassedProjection, factory, 128);
            expect(enabledAck).toEqual(disabledAck);
            expect(enabledAck).toEqual([
                { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 72 } },
            ]);

            const enabledSourceOff = enabledRack.processBlock(
                [noteOff(128, 60)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050, discontinuityEpoch: 1 },
                'track-a',
                true,
                'rack-a',
                'track-a',
                1
            );
            const disabledSourceOff = disabledRack.processBlock(
                [noteOff(128, 60)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050, discontinuityEpoch: 1 },
                'track-a'
            );
            expect(enabledSourceOff).toEqual(disabledSourceOff);
            expect(enabledSourceOff).toEqual([
                { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
            ]);
            expect(takePreviewBlock(enabledRack)).toMatchObject({ reset: true, records: [] });
        });

        it('settles and resets transformed output before acknowledging a reorder', () => {
            const rack = new MidiRack('rack-a');
            const factory = (type: ProcessorType, id: string): MidiProcessor => {
                if (type === 'transposer') {
                    return new Transposer(id);
                }
                return new ScaleQuantizer(id);
            };
            const firstProjection: YeastProcessorProjectionItem[] = [
                { id: 'transpose-1', type: 'transposer' as const, bypassed: false, params: { semitones: 12 } },
                { id: 'scale-1', type: 'scale' as const, bypassed: false, params: { transpose: 1 } },
            ];
            rack.replaceProjection(firstProjection, factory);
            expect(
                rack.processBlock([noteOn(0, 60)], 0, 128, { ...transport, discontinuityEpoch: 1 }, 'track-a')
            ).toMatchObject([{ kind: { type: 'noteOn', note: 74 } }]);

            const reordered = [firstProjection[1]!, firstProjection[0]!];
            expect(rack.replaceProjection(reordered, factory, 128)).toEqual([
                { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 74 } },
            ]);
            expect(
                rack.processBlock(
                    [noteOff(128, 60)],
                    128,
                    256,
                    { ...transport, ppqPosition: 128 / 22050, discontinuityEpoch: 1 },
                    'track-a'
                )
            ).toEqual([{ timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } }]);
        });

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

    describe('rack lifecycle generations', () => {
        it('bounds NoteRepeater echoes — repeats never re-enter the chain as fresh input (regression: echo storm)', () => {
            const rack = new MidiRack('rack-a');
            const repeater = new NoteRepeater('repeat-1');
            rack.addProcessor(repeater, 'repeater'); // defaults: repeat_count 3, rate 1/16

            // One noteOn, then ~2 s of continuous empty 128-sample blocks at
            // 44.1 kHz (689 blocks). Pre-fix the repeater drained its repeats
            // against a "generous" now+8192 window instead of the transport
            // block range, so echoes left the processor with timeSamples beyond
            // the rack's block end, parked in the rack scheduled queue, and
            // re-entered the chain top as fresh input — each echo spawning 3
            // more until the 4096-voice capacity throw (~1.5 s in the audit's
            // runtime proof). Post-fix the rack must emit exactly the original
            // note plus its 3 repeats (each with one off) and never throw.
            let noteOns = 0;
            let noteOffs = 0;
            let thrown: unknown;
            try {
                for (let block = 0; block < 689; block++) {
                    const start = block * 128;
                    const input = block === 0 ? [noteOn(0, 60)] : [];
                    const out = rack.processBlock(
                        input,
                        start,
                        start + 128,
                        { ...transport, ppqPosition: start / 22050 },
                        'track-a'
                    );
                    for (const event of out) {
                        if (isNoteOn(event)) {
                            noteOns++;
                        } else if (isNoteOff(event)) {
                            noteOffs++;
                        }
                    }
                }
            } catch (error) {
                thrown = error;
            }

            expect(thrown).toBeUndefined();
            expect(noteOns).toBe(4); // the original plus exactly 3 repeats
            expect(noteOffs).toBe(3); // one off per repeat (the input note stays held)
        });

        it('bounds ChordGenerator strum — strummed tones never re-enter the chain as fresh chord triggers (regression: chord multiplication)', () => {
            const rack = new MidiRack('rack-a');
            const chord = new ChordGenerator('chord-1');
            chord.setParam('strum_ms', 20); // 882-sample offsets at 44.1 kHz ≫ 128-sample blocks
            rack.addProcessor(chord, 'chord');

            // One noteOn, then ~100 ms of continuous 128-sample blocks.
            // Pre-fix the strummed tones left the processor with timeSamples
            // beyond the rack's block end, parked in the rack scheduled
            // queue, and re-entered the chain top — each strummed tone
            // triggering a NEW full chord (audit probe: 12-20 noteOns within
            // 100 ms with compounding pitches 60@0 64@882 67@1764 68@1764
            // 71@2646 …). Post-fix the rack must emit exactly the major triad.
            const pitches: number[] = [];
            for (let block = 0; block < 35; block++) {
                const start = block * 128;
                const input = block === 0 ? [noteOn(0, 60)] : [];
                const out = rack.processBlock(
                    input,
                    start,
                    start + 128,
                    { ...transport, ppqPosition: start / 22050 },
                    'track-a'
                );
                for (const event of out) {
                    if (isNoteOn(event)) {
                        pitches.push(event.kind.note);
                    }
                }
            }

            expect(pitches).toHaveLength(3);
            expect([...pitches].sort((a, b) => a - b)).toEqual([60, 64, 67]);
        });

        it('emits exactly one Note Off per Arpeggiator Note On (regression: duplicate offs)', () => {
            const rack = new MidiRack('rack-a');
            const arp = new Arpeggiator('arp-1');
            rack.addProcessor(arp, 'arpeggiator'); // defaults: up, 1/8 straight, gate 0.8

            // Hold one note for 250 × 128-sample blocks (1/8 steps at 120 bpm
            // = 11025 samples → ons at 11025 and 22050, offs at 19845 and
            // 30870). Pre-fix every generated off was emitted TWICE: once by
            // expireNotes at the next step boundary and again by the internal
            // scheduled drain — the two stores were never synchronized
            // (audit probe: 8 ons → 14 offs, duplicate pairs 60@19845 ×2,
            // 60@30870 ×2). Post-fix: exactly one off per on, no duplicate
            // note+time pair.
            let noteOns = 0;
            const offs: string[] = [];
            for (let block = 0; block < 250; block++) {
                const start = block * 128;
                const input = block === 0 ? [noteOn(0, 60)] : [];
                const out = rack.processBlock(
                    input,
                    start,
                    start + 128,
                    { ...transport, ppqPosition: start / 22050 },
                    'track-a'
                );
                for (const event of out) {
                    if (isNoteOn(event)) {
                        noteOns++;
                    } else if (isNoteOff(event)) {
                        offs.push(`${event.kind.note}@${event.timeSamples}`);
                    }
                }
            }

            expect(noteOns).toBe(2);
            expect(offs).toHaveLength(noteOns); // exactly one off per on
            expect(new Set(offs).size).toBe(offs.length); // no duplicate note+time off
        });

        it('never re-enters a generated note as chain input when a step lands exactly on the block boundary', () => {
            // 48 kHz, 120 bpm, rate_denom 1 → one arp step every 4 beats =
            // 96000 samples = exactly 750 × 128-sample blocks. The step
            // therefore falls on `blockEnd` of block 749 ([95872, 96000)).
            //
            // The generator loop condition is `lastStep + stepLen <= blockEnd`,
            // so the Note On is emitted with timeSamples === blockEnd; the rack
            // separator keeps `timeSamples < blockEndSamples`, so the event is
            // parked in the rack scheduled queue and re-drained into the CHAIN
            // TOP on the next block — where the Arpeggiator ingests its own
            // output as a fresh held note.
            //
            // A block is half-open: the chain's output for [blockStart, blockEnd)
            // must contain nothing at or beyond blockEnd, and nothing the rack
            // defers may ever be re-processed as input.
            const rack = new MidiRack('rack-a');
            const seenAtChainTop: MidiEvent[] = [];
            rack.addProcessor(new RecordingProcessor('probe-1', seenAtChainTop));
            const arp = new Arpeggiator('arp-1');
            arp.setParam('rate_denom', 1); // 4 beats per step
            rack.addProcessor(arp, 'arpeggiator');

            const boundaryTransport: TransportInfo = { ...transport, sampleRate: 48_000, bpm: 120 };
            const generatedOns: string[] = [];
            for (let block = 0; block < 760; block++) {
                const start = block * 128;
                const input = block === 0 ? [noteOn(0, 60)] : [];
                const out = rack.processBlock(
                    input,
                    start,
                    start + 128,
                    { ...boundaryTransport, ppqPosition: start / 24_000 },
                    'track-a'
                );
                for (const event of out) {
                    if (isNoteOn(event) && event.noteInstanceId?.startsWith('arp-1:generated:')) {
                        generatedOns.push(`${event.kind.note}@${event.timeSamples}`);
                    }
                }
            }

            // No event the arp generated is ever fed back into the chain top.
            expect(
                seenAtChainTop
                    .filter((event) => event.noteInstanceId?.startsWith('arp-1:generated:'))
                    .map((event) => `${event.noteInstanceId}@${event.timeSamples}`)
            ).toEqual([]);
            // The boundary step still reaches the host. The Arpeggiator only
            // passes through non-note events, so a generated Note On re-fed as
            // chain input is swallowed outright — the note never sounds.
            expect(generatedOns).toEqual(['60@96000']);
        });

        it('never re-enters a swung arp note as chain input', () => {
            // The boundary case is not special: swing (and ratchets) displace a
            // generated Note On far past the block that computed it. At 1/8 and
            // 120 bpm a step is 11025 samples, so full swing offsets every odd
            // step by 5512 samples — 43 blocks beyond its own block end. The
            // rack must defer those to the block that contains them, never
            // re-enter them at the chain top.
            const rack = new MidiRack('rack-a');
            const seenAtChainTop: MidiEvent[] = [];
            rack.addProcessor(new RecordingProcessor('probe-1', seenAtChainTop));
            const arp = new Arpeggiator('arp-1');
            arp.setParam('swing', 1);
            rack.addProcessor(arp, 'arpeggiator');

            const swungOns: number[] = [];
            for (let block = 0; block < 400; block++) {
                const start = block * 128;
                const input = block === 0 ? [noteOn(0, 60)] : [];
                const out = rack.processBlock(
                    input,
                    start,
                    start + 128,
                    { ...transport, ppqPosition: start / 22050 },
                    'track-a'
                );
                for (const event of out) {
                    if (isNoteOn(event) && event.noteInstanceId?.startsWith('arp-1:generated:')) {
                        swungOns.push(event.timeSamples);
                    }
                }
            }

            expect(seenAtChainTop.filter((event) => event.noteInstanceId?.startsWith('arp-1:generated:'))).toEqual([]);
            // Steps at 11025, 22050, 33075, 44100 across the 51200-sample span;
            // each odd step carries the full 5512.5-sample swing offset and
            // still arrives, in the block that contains it.
            expect(swungOns).toEqual([11025, 27562.5, 33075, 49612.5]);
        });

        it('panics audible state and clears NoteRepeater delay queues before a new discontinuity epoch', () => {
            const enabledRack = new MidiRack('rack-a');
            const disabledRack = new MidiRack('rack-a');
            for (const rack of [enabledRack, disabledRack]) {
                const repeater = new NoteRepeater('repeat-1');
                repeater.setParam('repeat_count', 1);
                rack.addProcessor(repeater, 'repeater');
            }

            const firstWithPreview = enabledRack.processBlock(
                [noteOn(0, 60)],
                0,
                128,
                { ...transport, discontinuityEpoch: 1 },
                'track-a',
                true,
                'rack-a',
                'track-a',
                1
            );
            const firstWithoutPreview = disabledRack.processBlock(
                [noteOn(0, 60)],
                0,
                128,
                { ...transport, discontinuityEpoch: 1 },
                'track-a'
            );
            expect(firstWithPreview).toEqual(firstWithoutPreview);
            expect(takePreviewBlock(enabledRack).records).toEqual(
                expect.arrayContaining([expect.objectContaining({ phase: 'open', pitch: 60 })])
            );

            const nextWithPreview = enabledRack.processBlock(
                [],
                1000,
                1128,
                { ...transport, ppqPosition: 1000 / 22050, discontinuityEpoch: 2 },
                'track-a',
                true,
                'rack-a',
                'track-a',
                1
            );
            const nextWithoutPreview = disabledRack.processBlock(
                [],
                1000,
                1128,
                { ...transport, ppqPosition: 1000 / 22050, discontinuityEpoch: 2 },
                'track-a'
            );

            expect(nextWithPreview).toEqual(nextWithoutPreview);
            expect(nextWithPreview).toEqual([
                { timeSamples: 1000, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
            ]);
            expect(takePreviewBlock(enabledRack)).toMatchObject({ reset: true, records: [] });
            expect(
                enabledRack.processBlock(
                    [],
                    5000,
                    9000,
                    { ...transport, ppqPosition: 5000 / 22050, discontinuityEpoch: 2 },
                    'track-a'
                )
            ).toEqual([]);
        });

        it('atomically settles, resets, and preview-resets when a stateful note-off mutates then throws', () => {
            const rack = new MidiRack('rack-a');
            const processor = new StatefulOffThenThrowProcessor('stateful-thrower');
            rack.addProcessor(processor);

            expect(
                rack.processBlock(
                    [noteOn(0, 60)],
                    0,
                    128,
                    { ...transport, discontinuityEpoch: 1 },
                    'track-a',
                    true,
                    'rack-a',
                    'track-a',
                    1
                )
            ).toEqual([
                { timeSamples: 0, trackId: 'track-a', kind: { type: 'noteOn', channel: 0, note: 72, velocity: 100 } },
            ]);
            expect(takePreviewBlock(rack).records).toMatchObject([{ phase: 'open', pitch: 72 }]);

            const failureOutput = rack.processBlock(
                [noteOff(128, 60)],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050, discontinuityEpoch: 1 },
                'track-a',
                true,
                'rack-a',
                'track-a',
                1
            );

            expect(failureOutput).toEqual([
                { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 72 } },
                { timeSamples: 128, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
            ]);
            expect(processor.resetCount).toBe(1);
            expect(takePreviewBlock(rack)).toMatchObject({
                reset: true,
                records: [],
                provenance: [{ processorId: 'stateful-thrower', failed: true }],
            });
            expect(rack.allNotesOff(512)).toEqual([]);
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

        it('rolls back preview decisions when a processor throws after recording one', () => {
            const rack = new MidiRack();
            rack.addProcessor(new DecisionThenThrowProcessor('throws-after-decision'));

            const output = rack.processBlock([noteOn(0, 60), noteOff(64, 60)], 0, 128, transport, 'track-a', true);
            const preview = takePreviewBlock(rack);

            expect(output).toMatchObject([noteOn(0, 60), noteOff(64, 60)]);
            expect(preview.records).toMatchObject([
                { phase: 'open', pitch: 60, probability: null, realized: true },
                { phase: 'closed', pitch: 60, probability: null, realized: true },
            ]);
            expect(preview.records[0]?.eventId).toBe(preview.records[1]?.eventId);
            expect(preview.provenance).toEqual([
                { processorId: 'throws-after-decision', eventCount: 0, bypassed: false, failed: true },
            ]);
        });

        it('clears retained lineage and keeps downstream processors running after a rack-generation failure', () => {
            const rack = new MidiRack();
            const probe = new LineageTokenProbeProcessor('probe');
            rack.addProcessor(new DecisionSourceProcessor('decision-source'));
            rack.addProcessor(new RetainAllThenThrowProcessor('throws-after-retain'));
            rack.addProcessor(probe);

            const output = rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);

            expect(output).toMatchObject([noteOn(0, 60)]);
            expect(probe.processed).toBe(true);
            expect(probe.retainedToken).toBeUndefined();
            expect(takePreviewBlock(rack)).toMatchObject({
                reset: true,
                records: [{ phase: 'open', pitch: 60, processorId: 'probe', realized: true }],
                provenance: [
                    { processorId: 'throws-after-retain', failed: true },
                    { processorId: 'probe', failed: false },
                ],
            });
        });

        it('publishes bounded preview for a default rack while passing audible events through', () => {
            const rack = new MidiRack();
            const input = [noteOn(0, 60), noteOff(64, 60)];

            const output = rack.processBlock(input, 0, 128, transport, 'track-a', true);
            const preview = takePreviewBlock(rack);

            expect(output).toEqual(input);
            expect(preview.records).toMatchObject([
                { phase: 'open', pitch: 60, realized: true },
                { phase: 'closed', pitch: 60, realized: true },
            ]);
            expect(preview.records).toHaveLength(2);
            expect(preview.provenance).toEqual([]);
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
                {
                    pitch: 60,
                    durationBeats: 2,
                    processorId: 'decision-source',
                    probability: 0.75,
                    realized: true,
                },
            ]);
        });

        it('rejects delayed lineage retained by an obsolete capture epoch', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new DecisionSourceProcessor('decision-source'));
            const repeater = createProcessor('repeater', 'repeater');
            repeater.setParam('repeat_count', 1);
            repeater.setParam('rate_denom', 1);
            rack.addProcessor(repeater, 'repeater');
            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true, 'rack-a', 'route-a', 1);
            takePreviewBlock(rack);

            const output = rack.processBlock(
                [{ timeSamples: 88000, kind: { type: 'cc', channel: 0, cc: 1, value: 64 } }],
                88000,
                97000,
                { ...transport, ppqPosition: 88000 / 22050 },
                'track-a',
                true,
                'rack-a',
                'route-a',
                2
            );

            expect(output.filter(isNoteOn)).toMatchObject([{ timeSamples: 88200, kind: { note: 60 } }]);
            expect(takePreviewBlock(rack)).toMatchObject({ records: [], droppedEvents: 1, reset: true });
        });

        it('retains delayed lineage as a bounded numeric token', () => {
            const rack = new MidiRack();
            const probe = new LineageTokenProbeProcessor('probe');
            rack.addProcessor(new DecisionSourceProcessor('decision-source'));
            rack.addProcessor(probe);

            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);

            expect(probe.retainedType).toBe('number');
        });

        it('counts realized decision overflow once without publishing fabricated lineage', () => {
            const rack = new MidiRack();
            rack.addProcessor(new DecisionSourceProcessor('decision-source'));
            rack.addProcessor(new KeepLastNoteProcessor('keep-last'));

            rack.processBlock(
                Array.from({ length: 513 }, (_, index) => noteOn(index, 36 + (index % 48))),
                0,
                1024,
                transport,
                'track-a',
                true
            );

            expect(takePreviewBlock(rack)).toMatchObject({ records: [], droppedEvents: 1 });
        });

        it('drops preview evidence when bounded retained-lineage tokens are exhausted', () => {
            const rack = new MidiRack();
            rack.addProcessor(new DecisionSourceProcessor('decision-source'));
            rack.addProcessor(new RetainedLineageExhaustionProcessor('exhaust-retained'));

            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);

            expect(takePreviewBlock(rack)).toMatchObject({ records: [], droppedEvents: 1 });
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
            const upcoming = takePreviewBlock(rack);
            expect(upcoming.records).toMatchObject([
                { rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a', pitch: 60, phase: 'open' },
            ]);

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
            expect(takePreviewBlock(rack).records).toEqual([]);

            rack.processBlock(
                [noteOff(256, 60)],
                256,
                384,
                { ...transport, ppqPosition: 256 / 22050 },
                'track-a',
                true
            );
            expect(takePreviewBlock(rack).records).toMatchObject([
                { eventId: upcoming.records[0]?.eventId, routeId: 'track-a', pitch: 60, phase: 'closed' },
            ]);
        });

        it('drops a queued future event when a transport discontinuity resets the rack generation', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));
            const futureNote = noteOn(192, 60);

            rack.processBlock(
                [futureNote],
                0,
                128,
                { ...transport, discontinuityEpoch: 1 },
                'track-a',
                true,
                'rack-a',
                'route-a',
                1
            );
            expect(takePreviewBlock(rack).records).toMatchObject([{ pitch: 60, phase: 'open' }]);

            const output = rack.processBlock(
                [],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050, discontinuityEpoch: 2 },
                'track-a',
                true,
                'rack-a',
                'route-a',
                1
            );
            const recaptured = takePreviewBlock(rack);

            expect(output).toEqual([]);
            expect(recaptured.reset).toBe(true);
            expect(recaptured.records).toEqual([]);
        });

        it('recaptures a queued future event under a replacement capture epoch', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));
            const futureNote = noteOn(192, 61);

            rack.processBlock(
                [futureNote],
                0,
                128,
                { ...transport, discontinuityEpoch: 1 },
                'track-a',
                true,
                'rack-a',
                'route-a',
                1
            );
            takePreviewBlock(rack);

            const output = rack.processBlock(
                [],
                128,
                256,
                { ...transport, ppqPosition: 128 / 22050, discontinuityEpoch: 1 },
                'track-a',
                true,
                'rack-a',
                'route-a',
                2
            );

            expect(output).toContain(futureNote);
            expect(takePreviewBlock(rack)).toMatchObject({
                reset: true,
                records: [expect.objectContaining({ routeId: 'route-a', trackId: 'track-a', pitch: 61 })],
            });
        });

        it('reclaims queued future-marker capacity through 512 enable and disable lifecycles', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));

            for (let index = 0; index < 512; index++) {
                const blockStart = index * 128;
                rack.processBlock(
                    [noteOn(1_000_000 + index, 36 + (index % 48))],
                    blockStart,
                    blockStart + 64,
                    { ...transport, ppqPosition: blockStart / 22050, discontinuityEpoch: index + 1 },
                    'track-a',
                    true,
                    'rack-a',
                    'route-a',
                    index + 1
                );
                expect(takePreviewBlock(rack).records).toHaveLength(1);
                rack.processBlock(
                    [],
                    blockStart + 64,
                    blockStart + 128,
                    { ...transport, ppqPosition: (blockStart + 64) / 22050, discontinuityEpoch: index + 1 },
                    'track-a',
                    false,
                    'rack-a',
                    'route-a',
                    index + 1
                );
            }

            const replacementStart = 512 * 128;
            rack.processBlock(
                [noteOn(2_000_000, 72)],
                replacementStart,
                replacementStart + 64,
                { ...transport, ppqPosition: replacementStart / 22050, discontinuityEpoch: 513 },
                'track-a',
                true,
                'rack-a',
                'route-a',
                513
            );

            expect(takePreviewBlock(rack)).toMatchObject({
                droppedEvents: 0,
                records: [expect.objectContaining({ routeId: 'route-a', trackId: 'track-a', pitch: 72 })],
            });
        });

        it('closes same-note preview identities within the active rack and route scope', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));

            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true, 'rack-a', 'route-a', 1);
            const routeAOpen = takePreviewBlock(rack).records[0]!;
            rack.processBlock([noteOn(128, 60)], 128, 256, transport, 'track-a', true, 'rack-a', 'route-b', 1);
            const routeBOpen = takePreviewBlock(rack).records[0]!;

            rack.processBlock(
                [noteOff(256, 60)],
                256,
                384,
                { ...transport, ppqPosition: 128 / 22050 },
                'track-a',
                true,
                'rack-a',
                'route-b',
                1
            );

            expect(routeBOpen.eventId).not.toBe(routeAOpen.eventId);
            expect(takePreviewBlock(rack).records).toMatchObject([
                { eventId: routeBOpen.eventId, rackId: 'rack-a', routeId: 'route-b', phase: 'closed' },
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

        it('keeps preview lineage across repeated calls that cover the same loop window', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));

            rack.processBlock([noteOn(0, 60)], 0, 128, transport, 'track-a', true);
            const opened = takePreviewBlock(rack);
            rack.processBlock([noteOff(64, 60)], 0, 128, transport, 'track-a', true);
            const closed = takePreviewBlock(rack);

            expect(opened.records).toMatchObject([{ phase: 'open', pitch: 60 }]);
            expect(closed.reset).toBe(false);
            expect(closed.records).toMatchObject([{ phase: 'closed', pitch: 60 }]);
            expect(closed.records[0]?.eventId).toBe(opened.records[0]?.eventId);
        });

        it('keeps preview lineage across realtime note windows separated by human timing', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));

            rack.processBlock([noteOn(1000, 60)], 1000, 1128, transport, 'track-a', true);
            const opened = takePreviewBlock(rack);
            rack.processBlock([noteOff(5000, 60)], 5000, 5128, transport, 'track-a', true);
            const closed = takePreviewBlock(rack);

            expect(opened.records).toMatchObject([{ phase: 'open', pitch: 60 }]);
            expect(closed.reset).toBe(false);
            expect(closed.records).toMatchObject([{ phase: 'closed', pitch: 60 }]);
            expect(closed.records[0]?.eventId).toBe(opened.records[0]?.eventId);
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
            const firstTransport = { ...transport, ppqPosition: 4, discontinuityEpoch: 1 };
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
                { ...testCase.nextTransport, discontinuityEpoch: 2 },
                'track-a',
                true
            );

            expect(takePreviewBlock(rack).records.map((record) => record.pitch)).toEqual([62, 62]);
        });

        it('publishes an empty reset when a transport discontinuity invalidates open preview state', () => {
            const rack = new MidiRack('rack-a');
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock(
                [noteOn(0, 60)],
                0,
                128,
                { ...transport, discontinuityEpoch: 1 },
                'track-a',
                true,
                'rack-a',
                'route-a',
                1
            );
            takePreviewBlock(rack);

            rack.processBlock(
                [],
                4096,
                4224,
                { ...transport, ppqPosition: 10, discontinuityEpoch: 2 },
                'track-a',
                true,
                'rack-a',
                'route-a',
                1
            );

            expect(takePreviewBlock(rack)).toMatchObject({ records: [], droppedEvents: 0, reset: true });
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
                reset: true,
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

        it.each([false, true])(
            'preserves upstream processor output when a later processor throws with preview capture %s',
            (previewEnabled) => {
                const rack = new MidiRack();
                rack.addProcessor(new DropFirstNoteProcessor('upstream'));
                rack.addProcessor(new ThrowingProcessor('thrower'));

                const output = rack.processBlock(
                    [noteOn(0, 60), noteOn(32, 62)],
                    0,
                    128,
                    transport,
                    'track-a',
                    previewEnabled
                );

                expect(output).toEqual([
                    {
                        timeSamples: 32,
                        trackId: 'track-a',
                        kind: { type: 'noteOn', channel: 0, note: 62, velocity: 100 },
                    },
                ]);
            }
        );

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

        it('drops future notes that never became audible without emitting phantom Note Offs', () => {
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
            expect(note67Offs).toHaveLength(0);
        });

        it('emits one Note Off for each overlapping audible same-key voice', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
                    { timeSamples: 1, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 90 } },
                ],
                0,
                128,
                transport,
                'track-a'
            );

            expect(rack.allNotesOff(500).filter(isNoteOff)).toEqual([
                { timeSamples: 500, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
                { timeSamples: 500, trackId: 'track-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
            ]);
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
