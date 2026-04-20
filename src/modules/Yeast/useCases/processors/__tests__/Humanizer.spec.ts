import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { Humanizer } from '../Humanizer';

describe('Humanizer', () => {
    let human: Humanizer;
    let transport: TransportInfo;

    beforeEach(() => {
        human = new Humanizer('test-human');
        transport = {
            isPlaying: true,
            ppqPosition: 0,
            bpm: 120,
            sampleRate: 44100,
            timeSignature: { numerator: 4, denominator: 4 },
        };
    });

    it('offsets note timing and velocity', () => {
        human.setParam('timing_sigma_ms', 10);
        human.setParam('vel_sigma', 10);

        const input: MidiEvent[] = [
            { timeSamples: 1000, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
        ];
        const output: MidiEvent[] = [];

        human.processMidi(input, output, transport);

        const event = output[0];
        expect(event.timeSamples).not.toBe(1000); // Shifting timing
        expect(event.kind.type).toBe('noteOn');
        if (event.kind.type === 'noteOn') {
            expect(event.kind.velocity).not.toBe(100); // Shifting velocity
        }
    });

    it('preserves note duration by applying same offset to noteOff', () => {
        const onInput: MidiEvent[] = [
            { timeSamples: 1000, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
        ];
        const onOutput: MidiEvent[] = [];
        human.processMidi(onInput, onOutput, transport);

        const onOffset = onOutput[0].timeSamples - 1000;

        const offInput: MidiEvent[] = [{ timeSamples: 2000, kind: { type: 'noteOff', channel: 0, note: 64 } }];
        const offOutput: MidiEvent[] = [];
        human.processMidi(offInput, offOutput, transport);

        const offOffset = offOutput[0].timeSamples - 2000;
        expect(offOffset).toBe(onOffset);
    });
});
