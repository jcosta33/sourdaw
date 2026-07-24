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

    // Voicing transforms derive from chord-voicing theory, not implementation
    // output. Drop-2 lowers the second-from-top chord tone an octave; drop-3
    // lowers the third-from-top. Both re-sort the intervals ascending.
    describe('drop-2 voicing lowers the 2nd-from-top chord tone an octave', () => {
        it('drop-2 on a C major triad drops the 3rd (E) down an octave', () => {
            // major [0,4,7]; drop2 drops interval[1] (4) → 4-12=-8 → [-8,0,7] sorted.
            // root 60 → [52, 60, 67] (G below, C, G).
            cg.setParam('voicing', 1); // 'drop2'
            cg.setParam('chord_type', 0); // major
            const output: MidiEvent[] = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            expect(output.filter(isNoteOn).map((e) => e.kind.note)).toEqual([52, 60, 67]);
        });

        it('drop-2 on a Cmaj7 drops the 3rd (E) down an octave', () => {
            // maj7 [0,4,7,11]; drop2 drops interval[2] (7) → 7-12=-5 → [-5,0,4,11] sorted.
            // root 60 → [55, 60, 64, 71].
            cg.setParam('voicing', 1); // 'drop2'
            cg.setParam('chord_type', 7); // maj7
            const output: MidiEvent[] = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            expect(output.filter(isNoteOn).map((e) => e.kind.note)).toEqual([55, 60, 64, 71]);
        });
    });

    describe('drop-3 voicing lowers the 3rd-from-top chord tone an octave', () => {
        it('drop-3 on a Cmaj7 drops the 5th (G) down an octave', () => {
            // maj7 [0,4,7,11]; drop3 drops interval[1] (4) → 4-12=-8 → [-8,0,7,11] sorted.
            // root 60 → [52, 60, 67, 71].
            cg.setParam('voicing', 2); // 'drop3'
            cg.setParam('chord_type', 7); // maj7
            const output: MidiEvent[] = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            expect(output.filter(isNoteOn).map((e) => e.kind.note)).toEqual([52, 60, 67, 71]);
        });

        it('drop-3 is a no-op on a triad (needs 4+ tones)', () => {
            // drop3 guard requires length >= 4; a major triad (3 tones) is left as close voicing.
            cg.setParam('voicing', 2); // 'drop3'
            cg.setParam('chord_type', 0); // major
            const output: MidiEvent[] = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            expect(output.filter(isNoteOn).map((e) => e.kind.note)).toEqual([60, 64, 67]);
        });
    });

    describe('strum direction offsets note times', () => {
        // Up-strum delays higher chord tones more; down-strum reverses it so the
        // top tone plays first. At sampleRate 44100, 1 ms ≈ 44.1 samples.
        it('down-strum schedules the highest tone earliest and the root latest', () => {
            cg.setParam('chord_type', 0); // major [0,4,7] → 60,64,67
            cg.setParam('strum_ms', 1);
            cg.setParam('strum_direction', 1); // 'down'
            const output: MidiEvent[] = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                { ...transport, blockStartSamples: 0, blockEndSamples: 200 }
            );
            const sortedByTime = [...output].filter(isNoteOn).sort((a, b) => a.timeSamples - b.timeSamples);
            // Down-strum: highest note (67) first, root (60) last.
            expect(sortedByTime.map((e) => e.kind.note)).toEqual([67, 64, 60]);
        });
    });

    describe('range and duration skips', () => {
        it('skips chord tones that fall outside the 0–127 MIDI range', () => {
            cg.setParam('chord_type', 0); // major [0,4,7]
            const output: MidiEvent[] = [];
            // Root at 0: tones 0, 4, 7 all valid. Root at -... can't go below 0 as input.
            // Instead push the root high enough that a tone overflows: root 121 → 121+7=128 → skipped.
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 121, velocity: 100 } }],
                output,
                transport
            );
            const notes = output.filter(isNoteOn).map((e) => e.kind.note);
            // 121 (root), 125 (4th) valid; 128 (7th) out of range → only two tones.
            expect(notes).toEqual([121, 125]);
        });

        it('skips chord tones whose strum offset consumes the entire duration', () => {
            cg.setParam('chord_type', 0); // major → 3 tones
            cg.setParam('strum_ms', 1); // ~44 samples between tones
            const output: MidiEvent[] = [];
            // durationSamples smaller than a later tone's strum offset → that tone is skipped.
            cg.processMidi(
                [
                    {
                        timeSamples: 0,
                        durationSamples: 45,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                output,
                { ...transport, blockStartSamples: 0, blockEndSamples: 200 }
            );
            // With ~44-sample strum steps, the 3rd tone's offset (~88) exceeds duration 45
            // → skipped. Fewer than 3 noteOns survive.
            expect(output.filter(isNoteOn).length).toBeLessThan(3);
        });
    });

    describe('noteOff and non-note pass-through', () => {
        it('passes a noteOff through unchanged when no chord was generated for it', () => {
            // A noteOff for a key that never had a noteOn has no stored chord → passthrough.
            const output: MidiEvent[] = [];
            cg.processMidi([{ timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 72 } }], output, transport);
            const offs = output.filter(isNoteOff);
            expect(offs).toHaveLength(1);
            expect(offs[0]?.kind.note).toBe(72);
        });

        it('passes non-note events through unchanged', () => {
            const output: MidiEvent[] = [];
            const cc = {
                timeSamples: 0,
                kind: { type: 'cc', channel: 0, cc: 7, value: 64 },
            } as MidiEvent;
            cg.processMidi([cc], output, transport);
            expect(output[0]).toBe(cc);
        });
    });

    describe('replaceParams resets voicing/chord to defaults before re-applying', () => {
        it('restores close major voicing after a drop-2 minor chord is configured', () => {
            cg.setParam('chord_type', 1); // minor
            cg.setParam('voicing', 1); // drop2
            let output: MidiEvent[] = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            // minor drop2: [0,3,7] → drop interval[1] (3) → -9 → [-9,0,7] → [51,60,67]
            expect(output.filter(isNoteOn).map((e) => e.kind.note)).toEqual([51, 60, 67]);

            // replaceParams with empty map resets to default close-major voicing.
            cg.replaceParams({});
            output = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            expect(output.filter(isNoteOn).map((e) => e.kind.note)).toEqual([60, 64, 67]);
        });
    });

    describe('setParam fallbacks', () => {
        it('falls back to the major chord for an out-of-range chord type index', () => {
            cg.setParam('chord_type', 999); // out of range → 'major'
            const output: MidiEvent[] = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            expect(output.filter(isNoteOn).map((e) => e.kind.note)).toEqual([60, 64, 67]);
        });

        it('falls back to close voicing for an out-of-range voicing index', () => {
            cg.setParam('voicing', 999); // out of range → 'close'
            const output: MidiEvent[] = [];
            cg.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                output,
                transport
            );
            expect(output.filter(isNoteOn).map((e) => e.kind.note)).toEqual([60, 64, 67]);
        });
    });

    describe('strummed-tone release on noteOff', () => {
        it('flushes a pending strummed tone to output when its source releases after its time', () => {
            // A strummed tone parked in the internal scheduled queue (its offset
            // pushed its time past the first block) must be flushed to output on
            // its noteOff, then released — not dropped.
            cg.setParam('chord_type', 0); // major → 60, 64, 67
            cg.setParam('strum_ms', 1); // ~44 samples/step
            const output: MidiEvent[] = [];
            // Block 1: noteOn at t=0 in a tiny block. Higher tones (strummed later)
            // park in the scheduled queue because their time > blockEnd.
            cg.processMidi(
                [
                    {
                        timeSamples: 0,
                        noteInstanceId: 'src-1',
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                output,
                { ...transport, blockStartSamples: 0, blockEndSamples: 20 }
            );
            // Block 2: noteOff well after all strum times. Pending tones whose
            // time < noteOff time are pushed to output before their off.
            cg.processMidi(
                [{ timeSamples: 200, noteInstanceId: 'src-1', kind: { type: 'noteOff', channel: 0, note: 60 } }],
                output,
                { ...transport, blockStartSamples: 20, blockEndSamples: 220 }
            );
            // All three chord tones should eventually appear (some parked, then flushed).
            const ons = output
                .filter(isNoteOn)
                .map((e) => e.kind.note)
                .sort((a, b) => a - b);
            expect(ons).toEqual([60, 64, 67]);
        });
    });

    describe('reset', () => {
        it('clears generated-voice tracking so a stale noteOff passes through', () => {
            const output: MidiEvent[] = [];
            cg.processMidi(
                [
                    {
                        timeSamples: 0,
                        noteInstanceId: 'src-1',
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                output,
                transport
            );
            // reset() drops the chord mapping. The pending noteOff now has no
            // stored chord → passes through unchanged (one off, original note).
            cg.reset();
            output.length = 0;
            cg.processMidi(
                [{ timeSamples: 10, noteInstanceId: 'src-1', kind: { type: 'noteOff', channel: 0, note: 60 } }],
                output,
                transport
            );
            expect(output.filter(isNoteOff)).toHaveLength(1);
            expect(output.find(isNoteOff)?.kind.note).toBe(60);
        });
    });
});
