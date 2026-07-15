import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { Humanizer } from '../Humanizer';

/** Assert the output has a first event and return it (narrows under noUncheckedIndexedAccess). */
function requireFirst(output: MidiEvent[]): MidiEvent {
    const first = output[0];
    expect(first).toBeDefined();
    return first as MidiEvent;
}

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
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
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

        const event = requireFirst(output);
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

        const onOffset = requireFirst(onOutput).timeSamples - 1000;

        const offInput: MidiEvent[] = [{ timeSamples: 2000, kind: { type: 'noteOff', channel: 0, note: 64 } }];
        const offOutput: MidiEvent[] = [];
        human.processMidi(offInput, offOutput, transport);

        const offOffset = requireFirst(offOutput).timeSamples - 2000;
        expect(offOffset).toBe(onOffset);
    });

    it('produces a deterministic Gaussian sequence from the shared LCG helper', () => {
        // Guards the gaussianLcg extraction: the same seed must yield the same
        // sequence of timing offsets it produced inline before the refactor.
        human.setParam('timing_sigma_ms', 10);
        human.setParam('vel_sigma', 0);

        function offsets(h: Humanizer): number[] {
            const out: number[] = [];
            for (let index = 0; index < 5; index++) {
                const o: MidiEvent[] = [];
                h.processMidi(
                    [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60 + index, velocity: 100 } }],
                    o,
                    transport
                );
                out.push(requireFirst(o).timeSamples);
            }
            return out;
        }

        const first = offsets(human);

        const human2 = new Humanizer('test-human');
        human2.setParam('timing_sigma_ms', 10);
        human2.setParam('vel_sigma', 0);
        const second = offsets(human2);

        expect(second).toEqual(first); // same seed → same stream
        expect(first.some((value) => value !== 0)).toBe(true); // and it actually varies
    });

    it('bounds noteTimingMap by evicting oldest entries when Note Offs are dropped', () => {
        // Regression: noteTimingMap was deleted only on a matching Note Off (or
        // reset). A transport seek before panic drops Note Offs, so the map grew
        // with every distinct un-released note. Feed strictly distinct, ever-
        // increasing keys (no Note Offs) past the ceiling and assert the map stays
        // bounded and the oldest entry was actually evicted (pruning happened).
        human.setParam('timing_sigma_ms', 5);

        const ceiling = 16 * 128;
        const firstKey = 0; // (channel 0 << 7) | note 0
        for (let note = 0; note < ceiling * 2; note++) {
            const out: MidiEvent[] = [];
            human.processMidi(
                [{ timeSamples: note, kind: { type: 'noteOn', channel: 0, note, velocity: 100 } }],
                out,
                transport
            );
        }

        const map = (human as unknown as { noteTimingMap: Map<number, number> }).noteTimingMap;
        expect(map.size).toBeLessThanOrEqual(ceiling);
        expect(map.has(firstKey)).toBe(false); // oldest entry evicted, not retained forever
    });
});
