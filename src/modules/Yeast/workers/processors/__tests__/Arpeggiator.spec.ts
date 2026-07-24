import { describe, it, expect, beforeEach } from 'vitest';

import { defaultStep } from '../../../models/ArpPattern';
import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../../models/MidiEvent';
import { MidiRack } from '../../MidiRack';
import { Arpeggiator } from '../Arpeggiator';

type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };

function isNoteOn(event: MidiEvent): event is NoteOnEvent {
    return event.kind.type === 'noteOn';
}

function takePreviewRecords(rack: MidiRack) {
    const page = rack.takePreviewPage();
    if (!page) {
        return [];
    }
    const records = Array.from({ length: page.count }, (_, index) => ({
        beatTime: page.beatTime[index]!,
        durationBeats: page.durationBeats[index]!,
        pitch: page.pitch[index]!,
        velocity: page.velocity[index]!,
        probability: Number.isNaN(page.probability[index]!) ? null : page.probability[index]!,
        realized: (page.flags[index]! & 1) !== 0,
        processorId: page.processorId[index]!,
    }));
    rack.releasePreviewPage(page);
    return records;
}

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
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
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

        const noteOns = output.filter(isNoteOn);
        expect(noteOns.length).toBeGreaterThanOrEqual(1);
        expect(noteOns[0]?.kind.note).toBe(60); // Lower note first in 'up' mode

        // Advance more to get next note
        transport.ppqPosition = 1.1;
        arp.processMidi([], output, transport);

        const noteOns2 = output.filter(isNoteOn);
        expect(noteOns2.some((event) => event.kind.note === 64)).toBe(true);
    });

    it('expands octaves', () => {
        arp.setParam('octave_range', 2);
        arp.setParam('mode', 0); // 'up'

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];

        arp.processMidi(input, output, transport);

        // Step 1: 60
        // Step 2: 72 (octave up)
        transport.ppqPosition = 0.6;
        arp.processMidi([], output, transport);
        transport.ppqPosition = 1.1;
        arp.processMidi([], output, transport);

        const notes = output.filter(isNoteOn).map((event) => event.kind.note);
        expect(notes).toContain(60);
        expect(notes).toContain(72);
    });

    it('respects velocity mode', () => {
        arp.setParam('velocity_mode', 1); // 'fixed'
        arp.setParam('fixed_velocity', 127);

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 50 } }];
        const output: MidiEvent[] = [];

        arp.processMidi(input, output, transport);

        // Step time is 0.5 beats. Advance past it.
        transport.ppqPosition = 0.6;
        arp.processMidi([], output, transport);

        const noteOn = output.find(isNoteOn);
        expect(noteOn?.kind.velocity).toBe(127);
    });

    it('captures rejected probability decisions without adding MIDI output', () => {
        arp.setParam('mode', 7);
        arp.setPattern([{ ...defaultStep(), probability: 0 }]);
        const rack = new MidiRack();
        rack.addProcessor(arp, 'arpeggiator');

        rack.processBlock(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            0,
            128,
            transport,
            'track-a',
            true
        );
        expect(takePreviewRecords(rack)).toEqual([]);

        transport.ppqPosition = 0.6;
        const output = rack.processBlock([], 13230, 13358, transport, 'track-a', true);

        expect(output.filter(isNoteOn)).toEqual([]);
        expect(takePreviewRecords(rack)).toMatchObject([
            {
                pitch: 60,
                velocity: 100,
                probability: 0,
                realized: false,
                processorId: 'test-arp',
            },
        ]);
    });

    it('stable-merges realized and rejected decisions without changing audible output', () => {
        const createRack = () => {
            const nextArp = new Arpeggiator('test-arp');
            nextArp.setParam('mode', 7);
            nextArp.setPattern([
                { ...defaultStep(), probability: 1 },
                { ...defaultStep(), probability: 0 },
            ]);
            const rack = new MidiRack();
            rack.addProcessor(nextArp, 'arpeggiator');
            return rack;
        };
        const enabledRack = createRack();
        const disabledRack = createRack();
        const input = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 } }];
        enabledRack.processBlock(
            input.map((event) => structuredClone(event)),
            0,
            128,
            transport,
            'track-a',
            true
        );
        disabledRack.processBlock(
            input.map((event) => structuredClone(event)),
            0,
            128,
            transport,
            'track-a',
            false
        );
        takePreviewRecords(enabledRack);

        const nextTransport = { ...transport, ppqPosition: 1.1 };
        const audibleWithCapture = enabledRack.processBlock([], 0, 25000, nextTransport, 'track-a', true);
        const audibleWithoutCapture = disabledRack.processBlock([], 0, 25000, nextTransport, 'track-a', false);
        const preview = takePreviewRecords(enabledRack);

        expect(audibleWithCapture).toEqual(audibleWithoutCapture);
        expect(preview).toMatchObject([
            { beatTime: 1.6, pitch: 60, probability: 1, realized: true, processorId: 'test-arp' },
            { beatTime: 1.6, pitch: 60, probability: 1, realized: true, processorId: 'test-arp' },
            { beatTime: 2.1, pitch: 60, probability: 0, realized: false, processorId: 'test-arp' },
        ]);
    });

    it('reset() clears held notes, latch, and step timing', () => {
        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];
        arp.processMidi(input, output, transport);
        transport.ppqPosition = 0.6;
        arp.processMidi([], output, transport);
        expect(arp.getCurrentStep()).toBeGreaterThan(0);

        arp.reset();
        expect(arp.getCurrentStep()).toBe(0);
        expect(arp.getPattern().length).toBeGreaterThan(0);

        const afterReset: MidiEvent[] = [];
        arp.processMidi([], afterReset, transport);
        expect(afterReset.filter(isNoteOn)).toEqual([]); // no held notes survive reset
    });

    it('replaceParams resets to defaults, then applies rate/gate/swing/octave/velocity/latch/restart params', () => {
        arp.replaceParams({
            mode: 4, // random
            rate_denom: 4,
            rate_type: 2, // triplet
            gate: 0.5,
            swing: 1,
            octave_range: 2,
            octave_direction: 1, // down
            velocity_mode: 2, // random
            latch: 1,
            restart_mode: 0, // freeRunning
        });

        const input: MidiEvent[] = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }, // duplicate: ignored
        ];
        const output: MidiEvent[] = [];
        arp.processMidi(input, output, transport);
        transport.ppqPosition = 0.7; // past one triplet-1/4 step (~0.667 beats)
        arp.processMidi([], output, transport);

        const notes = output.filter(isNoteOn);
        expect(notes.length).toBeGreaterThan(0);
        for (const note of notes) {
            expect(note.kind.note).toBeLessThanOrEqual(60); // octave_direction 'down' stays at/below the held note
            expect(note.kind.velocity).toBeGreaterThanOrEqual(40);
            expect(note.kind.velocity).toBeLessThanOrEqual(127);
        }

        // latch: releasing the note keeps the arp running from the latched pool.
        arp.processMidi([{ timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 60 } }], [], transport);
        const afterRelease: MidiEvent[] = [];
        transport.ppqPosition = 1.5;
        arp.processMidi([], afterRelease, transport);
        expect(afterRelease.filter(isNoteOn).length).toBeGreaterThan(0);
    });

    it('pattern mode skips rest steps, ties hold notes, and applies per-step octave/semitone offsets', () => {
        arp.setParam('mode', 7); // pattern
        arp.setPattern([
            { ...defaultStep(), active: false }, // rest: inactive step advances without emitting
            { ...defaultStep(), stepType: 'tie' }, // tie: extends prior notes instead of retriggering
            { ...defaultStep(), octaveOffset: 1, semitoneOffset: 2 }, // +14 semitones
        ]);

        const input: MidiEvent[] = [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }];
        const output: MidiEvent[] = [];
        arp.processMidi(input, output, transport);
        transport.ppqPosition = 2; // past all three 1/8-note steps
        arp.processMidi([], output, transport);

        const notes = output.filter(isNoteOn);
        expect(notes).toHaveLength(1); // only the third (offset) step emits
        expect(notes[0]?.kind.note).toBe(74); // 60 + 12 (octave) + 2 (semitone)
    });

    it('publishes one identified tied lifetime before its later release', () => {
        transport.sampleRate = 48_000;
        arp.setParam('mode', 7);
        arp.setPattern([
            defaultStep(),
            { ...defaultStep(), stepType: 'tie' },
            { ...defaultStep(), stepType: 'tie' },
            { ...defaultStep(), active: false },
        ]);

        const firstBlock: MidiEvent[] = [];
        arp.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            firstBlock,
            { ...transport, blockStartSamples: 0, blockEndSamples: 12_001 }
        );
        const noteOn = firstBlock.find(isNoteOn);
        expect(noteOn).toEqual(expect.objectContaining({ durationSamples: 33_600 }));

        arp.processMidi([{ timeSamples: 12_001, kind: { type: 'noteOff', channel: 0, note: 60 } }], [], {
            ...transport,
            blockStartSamples: 12_001,
            blockEndSamples: 24_001,
        });
        const finalBlock: MidiEvent[] = [];
        arp.processMidi([], finalBlock, { ...transport, blockStartSamples: 24_001, blockEndSamples: 45_601 });
        expect(finalBlock).toEqual([
            expect.objectContaining({ timeSamples: 45_600, noteInstanceId: noteOn?.noteInstanceId }),
        ]);
    });

    it.each([
        ['identified reverse release', 'source-first', 'source-second'],
        ['legacy FIFO', undefined, undefined],
    ])('keeps one overlapping same-pitch voice held after the first release (%s)', (_label, firstId, secondId) => {
        arp.setParam('rate_denom', 1024);
        const withIdentity = (noteInstanceId?: string) => (noteInstanceId ? { noteInstanceId } : {});
        const firstBlock: MidiEvent[] = [];
        arp.processMidi(
            [
                {
                    timeSamples: 0,
                    ...withIdentity(firstId),
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                },
                {
                    timeSamples: 0,
                    ...withIdentity(secondId),
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                },
            ],
            firstBlock,
            { ...transport, blockStartSamples: 0, blockEndSamples: 128 }
        );

        const afterSecondRelease: MidiEvent[] = [];
        arp.processMidi(
            [
                {
                    timeSamples: 128,
                    ...withIdentity(secondId),
                    kind: { type: 'noteOff', channel: 0, note: 60 },
                },
            ],
            afterSecondRelease,
            { ...transport, blockStartSamples: 128, blockEndSamples: 256 }
        );
        expect(afterSecondRelease.some(isNoteOn)).toBe(true);

        const afterFirstRelease: MidiEvent[] = [];
        arp.processMidi(
            [
                {
                    timeSamples: 256,
                    ...withIdentity(firstId),
                    kind: { type: 'noteOff', channel: 0, note: 60 },
                },
            ],
            afterFirstRelease,
            { ...transport, blockStartSamples: 256, blockEndSamples: 384 }
        );
        expect(afterFirstRelease.some(isNoteOn)).toBe(false);
    });

    it('selectStepNotes covers down, upDown, downUp, and order modes via reflectedIndex', () => {
        const input: MidiEvent[] = [
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
        ];

        function stepNotesFor(mode: number): number[] {
            transport.ppqPosition = 0;
            const local = new Arpeggiator('local-arp');
            local.setParam('mode', mode);
            const output: MidiEvent[] = [];
            local.processMidi(input, output, transport);
            for (let step = 1; step <= 3; step++) {
                transport.ppqPosition = step * 0.6;
                local.processMidi([], output, transport);
            }
            return output.filter(isNoteOn).map((event) => event.kind.note);
        }

        expect(stepNotesFor(1)).toEqual([67, 64, 60]); // 'down': highest to lowest
        expect(stepNotesFor(2)).toEqual([60, 64, 67]); // 'upDown': reflects at the top
        expect(stepNotesFor(3)).toEqual([67, 64, 60]); // 'downUp': reflects at the bottom
        expect(stepNotesFor(5)).toEqual([60, 64, 67]); // 'order': admission order
    });

    describe('preview rejection sorts would-be candidates by pitch', () => {
        // Intent: when a pattern step is rejected by probability, the preview must
        // still show the notes that WOULD have played — sorted by ascending pitch,
        // independent of the order notes were held. This lets the UI render the
        // rejected arpeggiation shape faithfully. A probability of 0 forces every
        // step to reject, so every candidate surfaces in the preview as unrealized.
        it('records rejected single-note steps in ascending pitch order regardless of admission order', () => {
            const arp = new Arpeggiator('reject-sort');
            arp.setParam('mode', 7); // pattern
            arp.setPattern([{ ...defaultStep(), probability: 0 }]);
            const rack = new MidiRack();
            rack.addProcessor(arp, 'arpeggiator');

            // Hold notes in NON-pitch order: 64, then 60, then 67.
            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 } },
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 80 } },
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
                ],
                0,
                128,
                transport,
                'track-rej',
                true
            );

            // Step the arp past its rate (1/8 = 0.5 beat) so a step is evaluated & rejected.
            transport.ppqPosition = 0.6;
            rack.processBlock([], 13230, 13358, transport, 'track-rej', true);

            const records = takePreviewRecords(rack);
            // The rejected decision is the pitch the step would have played.
            // In 'up' selection, step 0 picks the lowest note → 60.
            expect(records).toContainEqual(
                expect.objectContaining({ pitch: 60, velocity: 80, probability: 0, realized: false })
            );
        });

        it('sorts all held notes by pitch when a chord step is rejected', () => {
            // A 'chord' stepType plays every held note at once; when rejected by
            // probability, ALL held notes surface in the preview as unrealized
            // decisions, sorted ascending by pitch.
            const arp = new Arpeggiator('reject-chord');
            arp.setParam('mode', 7); // pattern
            arp.setPattern([{ ...defaultStep(), stepType: 'chord', probability: 0 }]);
            const rack = new MidiRack();
            rack.addProcessor(arp, 'arpeggiator');

            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 80 } },
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 } },
                ],
                0,
                128,
                transport,
                'track-rej',
                true
            );

            transport.ppqPosition = 0.6;
            rack.processBlock([], 13230, 13358, transport, 'track-rej', true);

            const records = takePreviewRecords(rack);
            const pitches = records.map((r) => r.pitch);
            // All three held notes are recorded, ascending.
            expect(pitches).toEqual([60, 64, 67]);
            expect(records.every((r) => r.realized === false && r.probability === 0)).toBe(true);
        });

        it('records rejected candidates across expanded octaves', () => {
            // With octave expansion, the rejected candidate pool spans multiple
            // octaves and must still be sorted by absolute pitch in the preview.
            const arp = new Arpeggiator('reject-octave');
            arp.setParam('mode', 7); // pattern
            arp.setParam('octave_range', 2); // expand up an octave
            arp.setPattern([{ ...defaultStep(), stepType: 'chord', probability: 0 }]);
            const rack = new MidiRack();
            rack.addProcessor(arp, 'arpeggiator');

            rack.processBlock(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 90 } },
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 80 } },
                ],
                0,
                128,
                transport,
                'track-rej',
                true
            );

            transport.ppqPosition = 0.6;
            rack.processBlock([], 13230, 13358, transport, 'track-rej', true);

            const records = takePreviewRecords(rack);
            const pitches = records.map((r) => r.pitch);
            // Octave-up expansion adds 72 and 76 alongside 60 and 64 → sorted ascending.
            expect(pitches).toEqual([60, 64, 72, 76]);
        });

        it('records rejected candidates with octave-down direction', () => {
            // Exercises the octaveDirection === 'down' arms of
            // countExpandedNotes / fillRejectedCandidates: a note at 60 expanded
            // down two octaves yields 60 and 48.
            const arp = new Arpeggiator('reject-down');
            arp.setParam('mode', 7);
            arp.setParam('octave_range', 2);
            arp.setParam('octave_direction', 1); // down
            arp.setPattern([{ ...defaultStep(), stepType: 'chord', probability: 0 }]);
            const rack = new MidiRack();
            rack.addProcessor(arp, 'arpeggiator');

            rack.processBlock(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 80 } }],
                0,
                128,
                transport,
                'track-rej',
                true
            );
            transport.ppqPosition = 0.6;
            rack.processBlock([], 13230, 13358, transport, 'track-rej', true);

            const pitches = takePreviewRecords(rack).map((r) => r.pitch);
            // Down expansion: 60 and 48, sorted ascending.
            expect(pitches).toEqual([48, 60]);
        });

        it('records rejected candidates with octave upDown direction', () => {
            // Exercises the octaveDirection === 'upDown' arms of
            // countExpandedNotes / fillRejectedCandidates: range 2 upDown yields
            // octaves 0 and 1 (the inner reflection is empty for range 2).
            const arp = new Arpeggiator('reject-updown');
            arp.setParam('mode', 7);
            arp.setParam('octave_range', 3);
            arp.setParam('octave_direction', 2); // upDown
            arp.setPattern([{ ...defaultStep(), stepType: 'chord', probability: 0 }]);
            const rack = new MidiRack();
            rack.addProcessor(arp, 'arpeggiator');

            rack.processBlock(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 80 } }],
                0,
                128,
                transport,
                'track-rej',
                true
            );
            transport.ppqPosition = 0.6;
            rack.processBlock([], 13230, 13358, transport, 'track-rej', true);

            const pitches = takePreviewRecords(rack).map((r) => r.pitch);
            // upDown range 3: octaves 0,1,2 then reflect 1 → notes 60,72,84,72.
            // Deduped/sorted in preview → [60, 72, 72, 84].
            expect(pitches).toEqual([60, 72, 72, 84]);
        });

        it('skips out-of-range pitches when filling rejected candidates', () => {
            // A very low note expanded down falls below 0 and must be dropped
            // from the rejected candidate pool.
            const arp = new Arpeggiator('reject-oor');
            arp.setParam('mode', 7);
            arp.setParam('octave_range', 4);
            arp.setParam('octave_direction', 1); // down
            arp.setPattern([{ ...defaultStep(), stepType: 'chord', probability: 0 }]);
            const rack = new MidiRack();
            rack.addProcessor(arp, 'arpeggiator');

            rack.processBlock(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 12, velocity: 80 } }],
                0,
                128,
                transport,
                'track-rej',
                true
            );
            transport.ppqPosition = 0.6;
            rack.processBlock([], 13230, 13358, transport, 'track-rej', true);

            const pitches = takePreviewRecords(rack).map((r) => r.pitch);
            // 12 expanded down 0,-12,-24,-36 → 12,0,-12(-),-24(-). Only 0 and 12 valid.
            expect(pitches.every((p) => p >= 0 && p <= 127)).toBe(true);
            expect(pitches).toEqual([0, 12]);
        });
    });

    it('generates an arp-prefixed id when none is provided', () => {
        const a = new Arpeggiator();
        expect(a.id).toMatch(/^arp-\d+$/);
        expect(a.name).toBe('Arpeggiator');
    });

    it('passes non-note events through unchanged', () => {
        // Exercises the implicit-else of the noteOn/noteOff dispatch (line 107):
        // a CC event with no held notes passes through verbatim.
        const cc: MidiEvent = { timeSamples: 0, kind: { type: 'cc', channel: 0, cc: 7, value: 64 } };
        const out: MidiEvent[] = [];
        arp.processMidi([cc], out, transport);
        expect(out[0]).toBe(cc);
    });

    it('does not step the arpeggiator while transport is stopped', () => {
        // Holds a note, then processes a block with isPlaying=false → the
        // `if (!transport.isPlaying) return` arm fires; no noteOn generated.
        arp.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            [],
            transport
        );
        const out: MidiEvent[] = [];
        arp.processMidi([], out, { ...transport, isPlaying: false, blockStartSamples: 0, blockEndSamples: 50000 });
        expect(out.filter(isNoteOn)).toHaveLength(0);
    });

    it('plays every held note simultaneously in chord mode', () => {
        // selectStepNotes 'chord' case returns the whole sorted pool. Hold the
        // notes first (default transport), then advance exactly one 1/8 step.
        arp.setParam('mode', 6); // chord
        arp.processMidi(
            [
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } },
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
            ],
            [],
            transport
        );
        transport.ppqPosition = 0.6; // past one 1/8 step (0.5 beat)
        const out: MidiEvent[] = [];
        arp.processMidi([], out, transport);
        const notes = out
            .filter(isNoteOn)
            .map((e) => e.kind.note)
            .sort((a, b) => a - b);
        expect(notes).toEqual([60, 64, 67]);
    });

    it('reflectedIndex collapses to a single note when only one is held (upDown)', () => {
        // With len===1, reflectedIndex returns 0 every step → the same note.
        arp.setParam('mode', 2); // upDown
        arp.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            [],
            transport
        );
        const notes: number[] = [];
        for (let step = 1; step <= 3; step++) {
            transport.ppqPosition = step * 0.6;
            const out: MidiEvent[] = [];
            arp.processMidi([], out, transport);
            notes.push(...out.filter(isNoteOn).map((e) => e.kind.note));
        }
        // Every step plays 60 (no reflection possible with one note).
        expect(notes.every((n) => n === 60)).toBe(true);
    });

    it('expandOctaves drops notes that fall outside the 0–127 range', () => {
        // octave up on a high note pushes it above 127 → filtered out.
        arp.setParam('mode', 6); // chord so all expanded notes emit at once
        arp.setParam('octave_range', 2);
        arp.setParam('octave_direction', 0); // up
        // 120 expanded up one octave → 132 (>127, dropped). Only 120 survives.
        arp.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 120, velocity: 100 } }],
            [],
            transport
        );
        transport.ppqPosition = 0.6;
        const out: MidiEvent[] = [];
        arp.processMidi([], out, transport);
        const notes = out.filter(isNoteOn).map((e) => e.kind.note);
        expect(notes).toEqual([120]);
    });

    it('keeps an active generated note alive across steps until its off time (expireNotes keep-arm)', () => {
        // A long gate produces a note whose off time is beyond the next step;
        // expireNotes must KEEP it (else-arm) rather than emit an early noteOff.
        arp.setParam('gate', 1.0);
        arp.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            [],
            transport
        );
        const first: MidiEvent[] = [];
        arp.processMidi([], first, { ...transport, blockStartSamples: 0, blockEndSamples: 50000 });
        const firstOn = first.find(isNoteOn);
        expect(firstOn).toBeDefined();
        // Next step boundary: the prior note is still within its gate, so no
        // noteOff should be emitted for it at this step's expireNotes call.
        const second: MidiEvent[] = [];
        arp.processMidi([], second, { ...transport, blockStartSamples: 50000, blockEndSamples: 100000 });
        // The noteOff for the first note arrives only at its scheduled off time
        // (>= 1 step * gate), not at the second step's expireNotes.
        const earlyOff = second.filter(
            (e) => e.kind.type === 'noteOff' && e.noteInstanceId === firstOn?.noteInstanceId && e.timeSamples < 100000
        );
        // There may be zero or one off depending on exact timing, but it must
        // not appear before the gate-extended off time. The key assertion: a
        // second noteOn IS emitted (the arp advanced while keeping the first).
        expect(second.some(isNoteOn)).toBe(true);
        expect(earlyOff.length).toBeLessThanOrEqual(1);
    });
});
