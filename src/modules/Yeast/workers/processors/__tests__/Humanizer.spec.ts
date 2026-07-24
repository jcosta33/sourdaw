import { describe, it, expect, beforeEach } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { gaussianLcg } from '../../lcgRandom';
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

    it('pairs overlapping identified voices in release order and preserves endpoint metadata', () => {
        human.setParam('timing_sigma_ms', 10);
        human.setParam('vel_sigma', 0);
        const onOutput: MidiEvent[] = [];
        human.processMidi(
            [
                {
                    timeSamples: 1_000,
                    trackId: 'track-a',
                    sourceEventId: 'source-a:on',
                    noteInstanceId: 'voice-a',
                    timePpq: 1,
                    tempoBpm: 60,
                    kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 },
                },
                {
                    timeSamples: 1_100,
                    trackId: 'track-a',
                    sourceEventId: 'source-b:on',
                    noteInstanceId: 'voice-b',
                    timePpq: 1.1,
                    tempoBpm: 120,
                    kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 },
                },
            ],
            onOutput,
            transport
        );
        const offsetByInstance = new Map(
            onOutput.map((event, index) => [event.noteInstanceId, event.timeSamples - (1_000 + index * 100)])
        );
        const offOutput: MidiEvent[] = [];
        human.processMidi(
            [
                {
                    timeSamples: 2_000,
                    trackId: 'track-a',
                    sourceEventId: 'source-b:off',
                    noteInstanceId: 'voice-b',
                    timePpq: 2,
                    tempoBpm: 120,
                    kind: { type: 'noteOff', channel: 0, note: 64 },
                },
                {
                    timeSamples: 2_100,
                    trackId: 'track-a',
                    sourceEventId: 'source-a:off',
                    noteInstanceId: 'voice-a',
                    timePpq: 2.1,
                    tempoBpm: 60,
                    kind: { type: 'noteOff', channel: 0, note: 64 },
                },
            ],
            offOutput,
            transport
        );

        expect(onOutput[0]).toEqual(
            expect.objectContaining({ sourceEventId: 'source-a:on', noteInstanceId: 'voice-a', tempoBpm: 60 })
        );
        expect(onOutput[1]).toEqual(
            expect.objectContaining({ sourceEventId: 'source-b:on', noteInstanceId: 'voice-b', tempoBpm: 120 })
        );
        expect(offOutput[0]?.timeSamples).toBe(2_000 + offsetByInstance.get('voice-b')!);
        expect(offOutput[1]?.timeSamples).toBe(2_100 + offsetByInstance.get('voice-a')!);
        expect(offOutput[0]).toEqual(
            expect.objectContaining({ sourceEventId: 'source-b:off', noteInstanceId: 'voice-b', tempoBpm: 120 })
        );
        expect(onOutput[0]?.timePpq).toBe(1 + (offsetByInstance.get('voice-a')! * 60) / (transport.sampleRate * 60));
        expect(onOutput[1]?.timePpq).toBe(1.1 + (offsetByInstance.get('voice-b')! * 120) / (transport.sampleRate * 60));
    });

    it('uses FIFO offset pairing for overlapping legacy voices', () => {
        human.setParam('timing_sigma_ms', 10);
        human.setParam('vel_sigma', 0);
        const onOutput: MidiEvent[] = [];
        human.processMidi(
            [
                { timeSamples: 1_000, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
                { timeSamples: 1_100, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
            ],
            onOutput,
            transport
        );
        const firstOffset = onOutput[0]!.timeSamples - 1_000;
        const secondOffset = onOutput[1]!.timeSamples - 1_100;
        const offOutput: MidiEvent[] = [];
        human.processMidi(
            [
                { timeSamples: 2_000, kind: { type: 'noteOff', channel: 0, note: 64 } },
                { timeSamples: 2_100, kind: { type: 'noteOff', channel: 0, note: 64 } },
            ],
            offOutput,
            transport
        );

        expect(offOutput.map((event, index) => event.timeSamples - (2_000 + index * 100))).toEqual([
            firstOffset,
            secondOffset,
        ]);
    });

    it('derives identified variation from stable identity instead of admission order', () => {
        function variationForOrder(ids: string[]): Map<string, { timeSamples: number; velocity: number }> {
            const processor = new Humanizer('stable-human');
            processor.setParam('timing_sigma_ms', 10);
            processor.setParam('vel_sigma', 10);
            const output: MidiEvent[] = [];
            processor.processMidi(
                ids.map((noteInstanceId) => ({
                    timeSamples: 0,
                    noteInstanceId,
                    kind: { type: 'noteOn' as const, channel: 0, note: 64, velocity: 100 },
                })),
                output,
                transport
            );
            return new Map(
                output.map((event) => [
                    event.noteInstanceId!,
                    {
                        timeSamples: event.timeSamples,
                        velocity: event.kind.type === 'noteOn' ? event.kind.velocity : 0,
                    },
                ])
            );
        }

        expect(variationForOrder(['voice-a', 'voice-b'])).toEqual(variationForOrder(['voice-b', 'voice-a']));
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

    it('degrades to neutral timing without throwing when voice tracking reaches capacity', () => {
        human.setParam('timing_mean_ms', 10);
        human.setParam('timing_sigma_ms', 0);
        human.setParam('vel_sigma', 0);

        const ceiling = 16 * 128;
        for (let index = 0; index < ceiling; index++) {
            human.processMidi(
                [
                    {
                        timeSamples: index,
                        trackId: `route-${index}`,
                        kind: { type: 'noteOn', channel: index % 16, note: index % 128, velocity: 100 },
                    },
                ],
                [],
                transport
            );
        }

        const overflowOutput: MidiEvent[] = [];
        expect(() =>
            human.processMidi(
                [
                    {
                        timeSamples: ceiling,
                        trackId: 'overflow-route',
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                overflowOutput,
                transport
            )
        ).not.toThrow();
        const queue = (human as unknown as { noteTimingVoices: { size: number } }).noteTimingVoices;
        expect(queue.size).toBe(0);
        expect(requireFirst(overflowOutput).timeSamples).toBe(ceiling);

        const disabledOutput: MidiEvent[] = [];
        human.processMidi(
            [{ timeSamples: ceiling + 1, kind: { type: 'noteOn', channel: 0, note: 61, velocity: 100 } }],
            disabledOutput,
            transport
        );
        expect(requireFirst(disabledOutput).timeSamples).toBe(ceiling + 1);

        human.reset();
        const recoveredOutput: MidiEvent[] = [];
        human.processMidi(
            [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 62, velocity: 100 } }],
            recoveredOutput,
            transport
        );
        expect(requireFirst(recoveredOutput).timeSamples).toBe(441);
    });

    it('passes through non-note events unchanged', () => {
        const ccEvent: MidiEvent = { timeSamples: 500, kind: { type: 'cc', channel: 0, cc: 1, value: 64 } };
        const output: MidiEvent[] = [];
        human.processMidi([ccEvent], output, transport);
        expect(output).toEqual([ccEvent]);
    });

    it('degrades identified-voice timing tracking at capacity and stays disabled for later notes', () => {
        human.setParam('timing_mean_ms', 10);
        human.setParam('timing_sigma_ms', 0);
        human.setParam('vel_sigma', 0);

        const ceiling = 16 * 128;
        for (let index = 0; index < ceiling; index++) {
            human.processMidi(
                [
                    {
                        timeSamples: index,
                        noteInstanceId: `voice-${index}`,
                        kind: { type: 'noteOn', channel: index % 16, note: index % 128, velocity: 100 },
                    },
                ],
                [],
                transport
            );
        }

        // This identified voice crosses the capacity threshold inside setInstanceOffset itself.
        const overflowOutput: MidiEvent[] = [];
        human.processMidi(
            [
                {
                    timeSamples: ceiling,
                    noteInstanceId: 'voice-overflow',
                    kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                },
            ],
            overflowOutput,
            transport
        );
        expect(requireFirst(overflowOutput).timeSamples).toBe(ceiling);

        // Tracking now stays disabled: a later identified note-on short-circuits too.
        const disabledOnOutput: MidiEvent[] = [];
        human.processMidi(
            [
                {
                    timeSamples: ceiling + 1,
                    noteInstanceId: 'voice-disabled',
                    kind: { type: 'noteOn', channel: 0, note: 61, velocity: 100 },
                },
            ],
            disabledOnOutput,
            transport
        );
        expect(requireFirst(disabledOnOutput).timeSamples).toBe(ceiling + 1);

        // ...and its matching identified note-off short-circuits as well.
        const disabledOffOutput: MidiEvent[] = [];
        human.processMidi(
            [
                {
                    timeSamples: ceiling + 100,
                    noteInstanceId: 'voice-disabled',
                    kind: { type: 'noteOff', channel: 0, note: 61 },
                },
            ],
            disabledOffOutput,
            transport
        );
        expect(requireFirst(disabledOffOutput).timeSamples).toBe(ceiling + 100);
    });

    it('replaceParams resets to defaults, then applies a named preset', () => {
        human.setParam('timing_mean_ms', 25); // wiped by the reset inside replaceParams
        human.replaceParams({ preset: 2 }); // 'drunk': timingMeanMs=2, timingSigmaMs=18

        const output: MidiEvent[] = [];
        human.processMidi(
            [{ timeSamples: 1000, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
            output,
            transport
        );

        const { value: expectedOffsetMs } = gaussianLcg(0xcafe, 2, 18);
        const expectedOffsetSamples = Math.round(expectedOffsetMs * 0.001 * transport.sampleRate);
        expect(requireFirst(output).timeSamples).toBe(1000 + expectedOffsetSamples);
    });

    describe('noteOff without a stored timing offset (?? 0 fallback)', () => {
        it('applies a zero offset to a legacy noteOff with no matching pending noteOn', () => {
            // A noteOff whose (track, channel, note) never had a noteOn has no
            // stored offset in the voice queue → shift() returns undefined → 0.
            const output: MidiEvent[] = [];
            human.processMidi(
                [{ timeSamples: 500, kind: { type: 'noteOff', channel: 0, note: 72 } }],
                output,
                transport
            );
            // The orphan noteOff passes through with a zero (neutral) offset.
            expect(requireFirst(output).timeSamples).toBe(500);
        });

        it('applies a zero offset to an identified noteOff whose noteInstanceId was never stored', () => {
            // An identified noteOff whose instance id has no stored offset →
            // map.get(key) returns undefined → 0.
            const output: MidiEvent[] = [];
            human.processMidi(
                [
                    {
                        timeSamples: 500,
                        noteInstanceId: 'never-seen',
                        kind: { type: 'noteOff', channel: 0, note: 72 },
                    },
                ],
                output,
                transport
            );
            expect(requireFirst(output).timeSamples).toBe(500);
        });
    });

    describe('timePpq tempo fallback (tempoBpm ?? transport.bpm)', () => {
        it('shifts timePpq using transport.bpm when the noteOn carries no tempoBpm', () => {
            human.setParam('timing_mean_ms', 10);
            human.setParam('timing_sigma_ms', 0);
            human.setParam('vel_sigma', 0);

            const output: MidiEvent[] = [];
            // noteOn with a timePpq but NO tempoBpm → the offset's ppq shift must
            // use transport.bpm (120) as the fallback, not NaN.
            human.processMidi(
                [
                    {
                        timeSamples: 1000,
                        timePpq: 4,
                        kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
                    },
                ],
                output,
                transport
            );
            const event = requireFirst(output);
            expect(event.timePpq).toBeDefined();
            // timing_mean_ms=10 → 441 samples offset. ppq shift = 441 * 120 / (44100*60) = 0.02.
            expect(event.timePpq).toBeCloseTo(4 + (441 * transport.bpm) / (transport.sampleRate * 60), 6);
        });

        it('shifts a matched noteOff timePpq using transport.bpm when it carries no tempoBpm', () => {
            human.setParam('timing_mean_ms', 10);
            human.setParam('timing_sigma_ms', 0);
            human.setParam('vel_sigma', 0);

            // First a noteOn to store an offset (441 samples).
            human.processMidi(
                [{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 } }],
                [],
                transport
            );
            // Then a noteOff with a timePpq but NO tempoBpm → the stored offset's
            // ppq shift must fall back to transport.bpm, not NaN.
            const output: MidiEvent[] = [];
            human.processMidi(
                [
                    {
                        timeSamples: 2000,
                        timePpq: 8,
                        kind: { type: 'noteOff', channel: 0, note: 60 },
                    },
                ],
                output,
                transport
            );
            const event = requireFirst(output);
            expect(event.timePpq).toBeDefined();
            // The matching noteOn stored a 441-sample offset; the noteOff reuses it.
            expect(event.timePpq).toBeCloseTo(8 + (441 * transport.bpm) / (transport.sampleRate * 60), 6);
        });
    });
});
