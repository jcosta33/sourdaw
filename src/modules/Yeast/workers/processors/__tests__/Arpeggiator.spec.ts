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
});
