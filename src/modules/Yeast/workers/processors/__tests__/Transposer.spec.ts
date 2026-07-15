import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../../models/MidiEvent';
import { Transposer } from '../Transposer';

type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };
type NoteOffEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOff' }> };

function isNoteOn(event: MidiEvent): event is NoteOnEvent {
    return event.kind.type === 'noteOn';
}

function isNoteOff(event: MidiEvent): event is NoteOffEvent {
    return event.kind.type === 'noteOff';
}

describe('Transposer', () => {
    let trans: Transposer;
    let transport: TransportInfo;

    beforeEach(() => {
        trans = new Transposer('test-trans');
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

    it('shifts notes by semitones and octaves', () => {
        trans.setParam('semitones', 2);
        trans.setParam('octaves', 1); // Total = +14 semitones

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];

        trans.processMidi(input, output, transport);

        const noteOn = output.find(isNoteOn);
        expect(noteOn?.kind.note).toBe(74); // 60 + 14
    });

    it('tracks transposition for Note Off', () => {
        trans.setParam('semitones', 7);

        const onInput: MidiEvent[] = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
        ];
        const output: MidiEvent[] = [];
        trans.processMidi(onInput, output, transport);

        const offInput: MidiEvent[] = [{ timeSamples: 500, kind: { type: 'noteOff', channel: 0, note: 60 } }];
        trans.processMidi(offInput, output, transport);

        const noteOff = output.find(isNoteOff);
        expect(noteOff?.kind.note).toBe(67); // 60 + 7
    });

    it('clamps notes to range', () => {
        trans.setParam('semitones', -100);
        trans.setParam('clamp_min', 12);

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];

        trans.processMidi(input, output, transport);

        const noteOn = output.find(isNoteOn);
        expect(noteOn?.kind.note).toBe(12);
    });
});
