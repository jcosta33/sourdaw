import { describe, it, expect, beforeEach } from 'vitest';
import { Arpeggiator } from '../Arpeggiator';
import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';

describe('Arpeggiator', () => {
    let arp: Arpeggiator;
    let transport: TransportInfo;

    beforeEach(() => {
        arp = new Arpeggiator('test-arp');
        transport = {
            isPlaying: true,
            ppqPosition: 0,
            bpm: 120,
            sampleRate: 44100,
            timeSignature: { numerator: 4, denominator: 4 },
        };
    });

    it('sequences notes in "up" mode', () => {
        const input: MidiEvent[] = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
        ];
        const output: MidiEvent[] = [];

        // First block: trigger held notes
        arp.processMidi(input, output, transport);

        // Advance transport to trigger first step (rate is 1/8 note = 0.5 beats = 22050 samples)
        transport.ppqPosition = 0.6;
        const input2: MidiEvent[] = [];
        arp.processMidi(input2, output, transport);

        const noteOns = output.filter(e => e.kind.type === 'noteOn');
        expect(noteOns.length).toBeGreaterThanOrEqual(1);
        expect(noteOns[0].kind.note).toBe(60); // Lower note first in 'up' mode
        
        // Advance more to get next note
        transport.ppqPosition = 1.1;
        arp.processMidi([], output, transport);
        
        const noteOns2 = output.filter(e => e.kind.type === 'noteOn');
        expect(noteOns2.some(e => e.kind.note === 64)).toBe(true);
    });

    it('expands octaves', () => {
        arp.setParam('octave_range', 2);
        arp.setParam('mode', 0); // 'up'
        
        const input: MidiEvent[] = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
        ];
        const output: MidiEvent[] = [];

        arp.processMidi(input, output, transport);
        
        // Step 1: 60
        // Step 2: 72 (octave up)
        transport.ppqPosition = 0.6;
        arp.processMidi([], output, transport);
        transport.ppqPosition = 1.1;
        arp.processMidi([], output, transport);

        const notes = output.filter(e => e.kind.type === 'noteOn').map(e => e.kind.note);
        expect(notes).toContain(60);
        expect(notes).toContain(72);
    });

    it('respects velocity mode', () => {
        arp.setParam('velocity_mode', 1); // 'fixed'
        arp.setParam('fixed_velocity', 127);
        
        const input: MidiEvent[] = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 50 } },
        ];
        const output: MidiEvent[] = [];

        arp.processMidi(input, output, transport);
        
        // Step time is 0.5 beats. Advance past it.
        transport.ppqPosition = 0.6;
        arp.processMidi([], output, transport);
        
        const noteOn = output.find(e => e.kind.type === 'noteOn');
        expect(noteOn?.kind.velocity).toBe(127);
    });
});
