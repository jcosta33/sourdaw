import { describe, it, expect } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../models/MidiEvent';
import { type MidiProcessor } from '../MidiProcessor';
import { MidiRack } from '../MidiRack';
import { ChordMemory } from '../processors/ChordMemory';
import { NoteFilter } from '../processors/NoteFilter';

type NoteOffEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOff' }> };
type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };

function isNoteOff(event: MidiEvent): event is NoteOffEvent {
    return event.kind.type === 'noteOff';
}

function isNoteOn(event: MidiEvent): event is NoteOnEvent {
    return event.kind.type === 'noteOn';
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
    processMidi(input: readonly MidiEvent[], output: MidiEvent[]): void {
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
            const createFilter = (_type: 'filter', id: string): MidiProcessor => new NoteFilter(id);

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
            const createFilter = (_type: 'filter', id: string): MidiProcessor => new NoteFilter(id);

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
            const createChordMemory = (_type: 'chordMemory', id: string): MidiProcessor => new ChordMemory(id);

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
