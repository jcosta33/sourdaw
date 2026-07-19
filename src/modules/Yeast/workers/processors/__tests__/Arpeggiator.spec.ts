import { describe, it, expect, beforeEach } from 'vitest';

import { defaultStep } from '../../../models/ArpPattern';
import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../../models/MidiEvent';
import {
    YEAST_PREVIEW_BYPASSED_FLAG,
    YEAST_PREVIEW_FAILED_FLAG,
    YEAST_PREVIEW_REALIZED_FLAG,
} from '../../../models/YeastPreviewSnapshot';
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
        realized: (page.flags[index]! & YEAST_PREVIEW_REALIZED_FLAG) !== 0,
        processorId: page.processorId[index]!,
        bypassed: (page.flags[index]! & YEAST_PREVIEW_BYPASSED_FLAG) !== 0,
        failed: (page.flags[index]! & YEAST_PREVIEW_FAILED_FLAG) !== 0,
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

    it('publishes the actual rejected probability decision without emitting MIDI', () => {
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
        expect(takePreviewRecords(rack)).toEqual([
            {
                beatTime: 0.5,
                durationBeats: 0.4,
                pitch: 60,
                velocity: 100,
                probability: 0,
                realized: false,
                processorId: 'test-arp',
                bypassed: false,
                failed: false,
            },
        ]);
    });
});
