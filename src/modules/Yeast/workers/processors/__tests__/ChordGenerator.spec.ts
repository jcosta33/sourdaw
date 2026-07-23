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

function noteOnAt(timeSamples: number, noteInstanceId: string): MidiEvent {
    return { timeSamples, noteInstanceId, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } };
}

function noteOffAt(timeSamples: number, noteInstanceId: string): MidiEvent {
    return { timeSamples, noteInstanceId, kind: { type: 'noteOff', channel: 0, note: 60 } };
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
            {
                timeSamples: 0,
                durationSamples: 500,
                noteInstanceId: 'source-a',
                kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
            },
        ];
        const output: MidiEvent[] = [];
        cg.processMidi(onInput, output, transport);

        const offInput: MidiEvent[] = [
            { timeSamples: 500, noteInstanceId: 'source-a', kind: { type: 'noteOff', channel: 0, note: 60 } },
        ];
        cg.processMidi(offInput, output, transport);

        const noteOns = output.filter(isNoteOn);
        const offNotes = output.filter(isNoteOff).map((event) => event.kind.note);
        expect(offNotes).toEqual([60, 64, 67]);
        expect(noteOns.map((event) => event.durationSamples)).toEqual([500, 500, 500]);
        expect(output.filter(isNoteOff).map((event) => event.noteInstanceId)).toEqual(
            noteOns.map((event) => event.noteInstanceId)
        );
    });

    it('cancels strummed tones whose realtime source releases before they start', () => {
        cg.setParam('strum_ms', 1);
        const output: MidiEvent[] = [];
        cg.processMidi([noteOnAt(0, 'tap'), noteOffAt(20, 'tap')], output, {
            ...transport,
            blockStartSamples: 0,
            blockEndSamples: 128,
        });
        cg.processMidi([], output, { ...transport, blockStartSamples: 128, blockEndSamples: 256 });

        expect(output.filter(isNoteOn).map((event) => event.kind.note)).toEqual([60]);
        expect(output.filter(isNoteOff).map((event) => event.kind.note)).toEqual([60]);
    });

    it('pairs overlapping identified chords in release order', () => {
        const output: MidiEvent[] = [];
        cg.processMidi([noteOnAt(0, 'first')], output, transport);
        const firstIds = output.filter(isNoteOn).map((event) => event.noteInstanceId);
        output.length = 0;
        cg.processMidi([noteOnAt(10, 'second')], output, transport);
        const secondIds = output.filter(isNoteOn).map((event) => event.noteInstanceId);
        output.length = 0;

        cg.processMidi([noteOffAt(20, 'second')], output, transport);
        expect(output.filter(isNoteOff).map((event) => event.noteInstanceId)).toEqual(secondIds);
        output.length = 0;
        cg.processMidi([noteOffAt(30, 'first')], output, transport);
        expect(output.filter(isNoteOff).map((event) => event.noteInstanceId)).toEqual(firstIds);
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
