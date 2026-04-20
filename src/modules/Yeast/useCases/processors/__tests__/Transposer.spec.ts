import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { Transposer } from '../Transposer';

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
            timeSignature: { numerator: 4, denominator: 4 },
        };
    });

    it('shifts notes by semitones and octaves', () => {
        trans.setParam('semitones', 2);
        trans.setParam('octaves', 1); // Total = +14 semitones

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];

        trans.processMidi(input, output, transport);

        const noteOn = output.find((e) => e.kind.type === 'noteOn');
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

        const noteOff = output.find((e) => e.kind.type === 'noteOff');
        expect(noteOff?.kind.note).toBe(67); // 60 + 7
    });

    it('clamps notes to range', () => {
        trans.setParam('semitones', -100);
        trans.setParam('clamp_min', 12);

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];

        trans.processMidi(input, output, transport);

        const noteOn = output.find((e) => e.kind.type === 'noteOn');
        expect(noteOn?.kind.note).toBe(12);
    });
});
