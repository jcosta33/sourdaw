import { describe, it, expect } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../models/MidiEvent';
import { type MidiProcessor } from '../MidiProcessor';
import { MidiRack } from '../MidiRack';

type NoteOffEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOff' }> };

function isNoteOff(event: MidiEvent): event is NoteOffEvent {
    return event.kind.type === 'noteOff';
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
                transport
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
                transport
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
                transport
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
                transport
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
            expect(offs.filter(isNoteOff).map((event) => event.kind.note)).toEqual([60]);
            expect(offs[0]?.timeSamples).toBe(256);
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
                transport
            );
            expect(out).toHaveLength(0);
            // The degenerate block must NOT have routed the input into the
            // scheduled queue. A later EMPTY block (no new input) would otherwise
            // resurface a ghost note. With the guard, nothing leaks out.
            const out2 = rack.processBlock([], 0, 1024, transport);
            expect(out2).toHaveLength(0);
        });

        it('still produces output for a normal block (blockEnd > blockStart)', () => {
            const rack = new MidiRack();
            rack.addProcessor(new PassthroughProcessor('p1'));
            const out = rack.processBlock(
                [{ timeSamples: 10, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                0,
                128,
                transport
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
                transport
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
                transport
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
                transport
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
                transport
            );
            const offs = rack.allNotesOff(500).filter(isNoteOff);
            // Same note number, different channels => two distinct offs.
            expect(offs).toHaveLength(2);
            expect(offs.map((event) => event.kind.channel).sort()).toEqual([0, 1]);
        });
    });
});
