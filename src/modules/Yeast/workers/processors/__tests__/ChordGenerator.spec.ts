import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../../models/MidiEvent';
import { ChordGenerator } from '../ChordGenerator';

type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };
type NoteOffEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOff' }> };

function isNoteOn(event: MidiEvent): event is NoteOnEvent {
    return event.kind.type === 'noteOn';
}

function isNoteOff(event: MidiEvent): event is NoteOffEvent {
    return event.kind.type === 'noteOff';
}

describe('ChordGenerator', () => {
    let cg: ChordGenerator;
    let transport: TransportInfo;

    beforeEach(() => {
        cg = new ChordGenerator('test-cg');
        transport = {
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
    });

    it('generates a major chord from a single note', () => {
        cg.setParam('chord_type', 0); // 'major' [0, 4, 7]

        const input: MidiEvent[] = [
            { timeSamples: 100, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
        ];
        const output: MidiEvent[] = [];

        cg.processMidi(input, output, transport);

        const notes = output.filter(isNoteOn).map((event) => event.kind.note);
        expect(notes).toEqual([60, 64, 67]);
    });

    it('sends noteOffs for all generated notes', () => {
        cg.setParam('chord_type', 0);

        const onInput: MidiEvent[] = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
        ];
        const output: MidiEvent[] = [];
        cg.processMidi(onInput, output, transport);

        const offInput: MidiEvent[] = [{ timeSamples: 500, kind: { type: 'noteOff', channel: 0, note: 60 } }];
        cg.processMidi(offInput, output, transport);

        const offNotes = output.filter(isNoteOff).map((event) => event.kind.note);
        expect(offNotes).toEqual([60, 64, 67]);
    });

    it('applies spread voicing', () => {
        cg.setParam('voicing', 3); // 'spread'
        cg.setParam('chord_type', 0); // major [0, 4, 7] -> idx 1 is +4, idx 2 is +7
        // formula becomes [0 + 0, 4 + 12, 7 + 0] = [0, 16, 7]
        // wait, implementation is: intervals = intervals.map((intv, idx) => intv + (idx % 2 === 1 ? 12 : 0));
        // major [0, 4, 7]: idx 0: 0+0=0, idx 1: 4+12=16, idx 2: 7+0=7
        // sorted output: 60, 67, 76.

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];
        cg.processMidi(input, output, transport);

        const notes = output.filter(isNoteOn).map((event) => event.kind.note);
        expect(notes).toContain(60);
        expect(notes).toContain(67);
        expect(notes).toContain(76);
    });
});
