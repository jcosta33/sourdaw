import { describe, it, expect } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../../models/MidiEvent';
import { ScaleQuantizer } from '../ScaleQuantizer';

type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };

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

function quantize(gen: ScaleQuantizer, note: number): number | undefined {
    const output: MidiEvent[] = [];
    gen.processMidi([{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note, velocity: 100 } }], output, transport);
    return output.find(isNoteOn)?.kind.note;
}

describe('ScaleQuantizer', () => {
    it('exports ScaleQuantizer', () => {
        expect(ScaleQuantizer).toBeDefined();
    });

    describe('quantizeToScale', () => {
        it('snaps an out-of-scale note into C major', () => {
            const gen = new ScaleQuantizer('sq-test');
            // root=C(0), scale=major(0). C# (61) is not in C major -> snaps to C or D.
            expect([60, 62]).toContain(quantize(gen, 61));
        });

        it('leaves an in-scale note untouched', () => {
            const gen = new ScaleQuantizer('sq-test');
            expect(quantize(gen, 60)).toBe(60); // C is in C major
        });
    });

    describe('diatonicTranspose (fix #3: dead branch removed, behavior preserved)', () => {
        it('transposes an in-scale note by scale degrees', () => {
            const gen = new ScaleQuantizer('sq-test');
            // C major, transpose +1 degree: C(60) -> D(62).
            gen.setParam('transpose', 1);
            expect(quantize(gen, 60)).toBe(62);
        });

        it('transposes across the octave boundary', () => {
            const gen = new ScaleQuantizer('sq-test');
            // C major, transpose +7 degrees: C(60) -> C one octave up (72).
            gen.setParam('transpose', 7);
            expect(quantize(gen, 60)).toBe(72);
        });

        it('first quantizes an out-of-scale note then transposes it', () => {
            const gen = new ScaleQuantizer('sq-test');
            gen.setParam('remap_mode', 1); // 'up' -> C#(61) snaps up to D(62)
            gen.setParam('transpose', 1); // then +1 degree: D -> E(64)
            expect(quantize(gen, 61)).toBe(64);
        });
    });

    describe('processMidi (fix #4: no audio-thread throw on remap mode)', () => {
        it('does not throw for any clamped remap mode', () => {
            const gen = new ScaleQuantizer('sq-test');
            for (let modeIdx = 0; modeIdx <= 3; modeIdx++) {
                gen.setParam('remap_mode', modeIdx);
                const output: MidiEvent[] = [];
                expect(() =>
                    gen.processMidi(
                        [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 61, velocity: 100 } }],
                        output,
                        transport
                    )
                ).not.toThrow();
            }
        });
    });
});
