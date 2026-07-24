import { describe, it, expect } from 'vitest';

import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../../models/MidiEvent';
import { ScaleQuantizer } from '../ScaleQuantizer';

type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };
type NoteOffEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOff' }> };

function isNoteOn(event: MidiEvent): event is NoteOnEvent {
    return event.kind.type === 'noteOn';
}
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

    // C-major scale tones (pitch classes): C D E F G A B = {0,2,4,5,7,9,11}.
    // Accidentals C# D# F# G# A# = {1,3,6,8,10} are the five notes a quantizer
    // must pull into the scale. The expectations below are derived from music
    // theory (nearest diatonic tone), not copied from the implementation.
    describe('nearest mode snaps every chromatic pitch class to the closest C-major tone', () => {
        // Octave 4 (60..71). Expected pc after snapping, derived by hand:
        //   C(0)→C  C#(1)→C  D(2)→D  D#(3)→D  E(4)→E  F(5)→F
        //   F#(6)→F  G(7)→G  G#(8)→G  A(9)→A  A#(10)→A  B(11)→B
        // An accidental sits exactly between two scale tones; when distance ties,
        // it snaps DOWN to the lower scale tone (C# is equidistant from C and D
        // but resolves to C).
        const expectedPc = [0, 0, 2, 2, 4, 5, 5, 7, 7, 9, 9, 11];

        for (let pc = 0; pc < 12; pc++) {
            const target = expectedPc[pc]!;
            it(`pc ${pc} (${noteName(pc)}) snaps to pc ${target} (${noteName(target)})`, () => {
                const gen = new ScaleQuantizer('sq-nearest');
                const result = quantize(gen, 60 + pc);
                expect(result).toBe(60 + target);
            });
        }
    });

    describe('up mode snaps each accidental up to the next scale tone', () => {
        // "Up" mode walks chromatically upward to the next scale degree:
        //   C#→D  D#→E  F#→G  G#→A  A#→B
        const cases: Array<[number, number]> = [
            [1, 2],
            [3, 4],
            [6, 7],
            [8, 9],
            [10, 11],
        ];
        for (const [accidental, target] of cases) {
            it(`pc ${accidental} (${noteName(accidental)}) snaps up to pc ${target} (${noteName(target)})`, () => {
                const gen = new ScaleQuantizer('sq-up');
                gen.setParam('remap_mode', 1); // 'up'
                expect(quantize(gen, 60 + accidental)).toBe(60 + target);
            });
        }
        it('leaves in-scale tones untouched in up mode', () => {
            const gen = new ScaleQuantizer('sq-up-inscale');
            gen.setParam('remap_mode', 1);
            expect(quantize(gen, 60)).toBe(60); // C is already in scale
        });
    });

    describe('down mode snaps each accidental down to the previous scale tone', () => {
        // "Down" mode walks chromatically downward to the previous scale degree:
        //   C#→C  D#→D  F#→F  G#→G  A#→A
        const cases: Array<[number, number]> = [
            [1, 0],
            [3, 2],
            [6, 5],
            [8, 7],
            [10, 9],
        ];
        for (const [accidental, target] of cases) {
            it(`pc ${accidental} (${noteName(accidental)}) snaps down to pc ${target} (${noteName(target)})`, () => {
                const gen = new ScaleQuantizer('sq-down');
                gen.setParam('remap_mode', 2); // 'down'
                expect(quantize(gen, 60 + accidental)).toBe(60 + target);
            });
        }
        it('leaves in-scale tones untouched in down mode', () => {
            const gen = new ScaleQuantizer('sq-down-inscale');
            gen.setParam('remap_mode', 2);
            expect(quantize(gen, 60)).toBe(60);
        });
    });

    describe('nearest mode octave-wrap (diff < -6 arm)', () => {
        // C pentatonic major scale tones are C D E G A = {0,2,4,7,9}. B (pc=11)
        // is out of scale; its nearest scale tone is C(0), reached by going UP
        // one semitone across the octave boundary. In pitch-class space the
        // winning `diff = scalePc - pc = 0 - 11 = -11`; since -11 < -6 the
        // octave-wrap arm maps it to -11 + 12 = +1, so note 71 (B4) -> 72 (C5).
        it('wraps B up to C in C pentatonic major (nearest)', () => {
            const gen = new ScaleQuantizer('sq-penta-wrap');
            gen.setParam('scale', 8); // pentatonicMajor
            expect(quantize(gen, 71)).toBe(72); // B4 -> C5
        });

        // F (pc=5) in C pentatonic major is out of scale; equidistant from
        // E(4) and G(7) but E is visited first → snaps down to E via diff = -1.
        it('snaps F down to E in C pentatonic major (no-wrap arm)', () => {
            const gen = new ScaleQuantizer('sq-penta-nodiff');
            gen.setParam('scale', 8); // pentatonicMajor
            expect(quantize(gen, 65)).toBe(64); // F4 -> E4
        });
    });

    describe('non-C roots recenter the scale', () => {
        // With root=G(7), the G-major scale tones are G A B C D E F# =
        // {7,9,11,0,2,4,6} modulo 12. F(5) is not in G major (F# is) and snaps
        // up by one semitone to F#(6).
        it('snaps F up to F# when the root is G major', () => {
            const gen = new ScaleQuantizer('sq-gmajor');
            gen.setParam('root', 7); // G
            gen.setParam('remap_mode', 1); // 'up'
            expect(quantize(gen, 65)).toBe(66); // F(65) -> F#(66)
        });
    });

    describe('noteOn→noteOff lineage', () => {
        // A remapped Note On must be matched by a Note Off for the REMAPPED
        // pitch. The quantizer keys the mapping on the *original* input note,
        // so a Note Off for original C# must release the snapped C voice.
        it('releases the snapped pitch on noteOff, keyed by the original note', () => {
            const gen = new ScaleQuantizer('sq-lineage');
            const out: MidiEvent[] = [];
            gen.processMidi(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 61, velocity: 100 } },
                    { timeSamples: 10, kind: { type: 'noteOff', channel: 0, note: 61 } },
                ],
                out,
                transport
            );
            const ons = out.filter(isNoteOn);
            const offs = out.filter(isNoteOff);
            expect(ons).toHaveLength(1);
            expect(offs).toHaveLength(1);
            // C#(61) snapped to C(60) in nearest mode; the off must release C(60).
            expect(ons[0]?.kind.note).toBe(60);
            expect(offs[0]?.kind.note).toBe(60);
        });

        it('falls back to the original pitch when no mapping exists for the noteOff', () => {
            // A noteOff for a key that was never pressed (no prior noteOn) has
            // no stored mapping → it must pass through at its original pitch.
            const gen = new ScaleQuantizer('sq-unmapped-off');
            const out: MidiEvent[] = [];
            gen.processMidi([{ timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 70 } }], out, transport);
            const offs = out.filter(isNoteOff);
            expect(offs).toHaveLength(1);
            expect(offs[0]?.kind.note).toBe(70);
        });
    });

    describe('non-note events pass through unchanged', () => {
        it('passes CC events through untouched', () => {
            const gen = new ScaleQuantizer('sq-cc');
            const cc = {
                timeSamples: 0,
                kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
            } as MidiEvent;
            const out: MidiEvent[] = [];
            gen.processMidi([cc], out, transport);
            expect(out[0]).toBe(cc);
        });
    });

    describe('reset clears held note-voice state', () => {
        it('drops the remap mapping so a stale noteOff falls back to its original pitch', () => {
            const gen = new ScaleQuantizer('sq-reset');
            const out: MidiEvent[] = [];
            // Press C#(61) → snaps to C(60), mapping 61→60 is stored.
            gen.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 61, velocity: 100 } }],
                out,
                transport
            );
            expect(out.find(isNoteOn)?.kind.note).toBe(60);

            // reset() clears the voice queue. The pending noteOff now has no
            // stored mapping, so it must release the *original* C#(61), not C.
            gen.reset();
            const offOut: MidiEvent[] = [];
            gen.processMidi([{ timeSamples: 10, kind: { type: 'noteOff', channel: 0, note: 61 } }], offOut, transport);
            expect(offOut.find(isNoteOff)?.kind.note).toBe(61);
        });
    });

    describe('setParam fallbacks', () => {
        it('falls back to the major scale for an out-of-range scale index', () => {
            const gen = new ScaleQuantizer('sq-scale-fallback');
            gen.setParam('scale', 999); // out of range → 'major'
            // C#(61) snaps to C(60) under C-major nearest mode
            expect(quantize(gen, 61)).toBe(60);
        });

        it('falls back to nearest remap for an out-of-range remap index', () => {
            const gen = new ScaleQuantizer('sq-remap-fallback');
            gen.setParam('remap_mode', 999); // out of range → 'nearest'
            expect(quantize(gen, 61)).toBe(60);
        });
    });

    describe('replaceParams resets to defaults then re-applies', () => {
        // replaceParams calls resetParams() first (root/scale/remap/transpose →
        // defaults), then applies the given params. Setting only 'root' must
        // therefore reset a previously-chosen 'up' remap back to 'nearest'.
        it('resets remap_mode to nearest before applying the new param map', () => {
            const gen = new ScaleQuantizer('sq-replace');
            gen.setParam('remap_mode', 1); // 'up' → C#(61) snaps to D(62)
            expect(quantize(gen, 61)).toBe(62);

            gen.replaceParams({ root: 0 }); // remap_mode reset to 'nearest'
            // nearest mode: C# ties between C and D → snaps DOWN to C(60)
            expect(quantize(gen, 61)).toBe(60);
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

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(pc: number): string {
    return NOTE_NAMES[((pc % 12) + 12) % 12]!;
}
