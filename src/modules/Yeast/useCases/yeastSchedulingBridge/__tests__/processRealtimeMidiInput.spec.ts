import { describe, it, expect, beforeEach, vi } from 'vitest';

import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { processRealtimeMidiInput } from '../processRealtimeMidiInput';
import { processYeastMidi } from '../processYeastMidi';

import type { MidiEvent } from '../../../models/MidiEvent';

vi.mock('../processYeastMidi', () => ({
    processYeastMidi: vi.fn(),
}));
vi.mock('../../getYeastSchedulingLookahead', () => ({
    getYeastSchedulingLookahead: () => ({ earlyBeats: 0.1, lateBeats: 0.2 }),
}));

/**
 * The ingress block this suite's 48 kHz fixtures produce: sample time 48000,
 * plus the 0.1 s worker lookahead (4800) and the 0.1 beat early window (2400),
 * so the source event lands at 55200 and the block ends at 60001.
 */
const INGRESS_BLOCK_END = 60_001;

function make_input(overrides: Partial<Parameters<typeof processRealtimeMidiInput>[0]> = {}) {
    return {
        context: {} as BaseAudioContext,
        rackId: 'rack-a',
        trackId: 'track-a',
        note: 60,
        velocity: 96,
        channel: 2,
        isNoteOn: true,
        sampleTime: 48_000,
        sampleRate: 48_000,
        noteInstanceId: 'realtime-voice-a',
        ...overrides,
    };
}

describe('processRealtimeMidiInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate note-on input through the Yeast MIDI processor', async () => {
        const processed_events = [
            {
                timeSamples: 512,
                kind: { type: 'noteOn' as const, channel: 1, note: 64, velocity: 88 },
            },
        ];
        vi.mocked(processYeastMidi).mockResolvedValue(processed_events);

        const context = {} as BaseAudioContext;
        const result = await processRealtimeMidiInput({
            context,
            rackId: 'rack-a',
            trackId: 'track-a',
            note: 60,
            velocity: 96,
            channel: 2,
            isNoteOn: true,
            sampleTime: 128,
            sampleRate: 48000,
            noteInstanceId: 'realtime-voice-a',
            blockSize: 64,
        });

        expect(processYeastMidi).toHaveBeenCalledWith(
            expect.objectContaining({
                context,
                rackId: 'rack-a',
                trackId: 'track-a',
                events: [
                    {
                        timeSamples: 7328,
                        trackId: 'track-a',
                        sourceEventId: 'track-a:2:60:on:128',
                        noteInstanceId: 'realtime-voice-a',
                        kind: { type: 'noteOn', channel: 2, note: 60, velocity: 96 },
                    },
                ],
                blockStartSamples: 128,
                blockEndSamples: 12129,
            })
        );
        expect(vi.mocked(processYeastMidi).mock.calls[0]?.[0].transport.ppqPosition).toBeCloseTo(-0.3, 10);
        expect(result).toBe(processed_events);
    });

    it('pumps empty blocks until a generated note-off drains while the transport is stopped (#4870)', async () => {
        vi.useFakeTimers();
        try {
            // The ingress block emits a generated note-on whose held lifetime
            // reaches past the block; its note-off only exists once a LATER
            // empty block is processed (Arpeggiator tie lifetimes).
            const ingress: MidiEvent = {
                timeSamples: 55_200,
                trackId: 'track-a',
                noteInstanceId: 'realtime-voice-a',
                durationSamples: 33_600,
                kind: { type: 'noteOn', channel: 2, note: 60, velocity: 96 },
            };
            const release: MidiEvent = {
                timeSamples: 88_800,
                trackId: 'track-a',
                noteInstanceId: 'arp-1:generated:1',
                kind: { type: 'noteOff', channel: 2, note: 60 },
            };
            let released = false;
            vi.mocked(processYeastMidi).mockImplementation(async (input) => {
                if (input.events.length > 0) {
                    return [ingress];
                }
                if (!released && input.blockEndSamples >= 88_800) {
                    released = true;
                    return [release];
                }
                return [];
            });
            const drained: MidiEvent[] = [];

            const result = await processRealtimeMidiInput(
                make_input({
                    onDrainedEvents: (events) => {
                        drained.push(...events);
                    },
                })
            );

            // The source note-on is not held back by the drain.
            expect(result).toEqual([ingress]);
            await vi.runAllTimersAsync();

            const emptyCalls = vi.mocked(processYeastMidi).mock.calls.filter((call) => call[0].events.length === 0);
            expect(emptyCalls.length).toBeGreaterThan(0);
            expect(emptyCalls[0]![0]).toMatchObject({ events: [], blockStartSamples: INGRESS_BLOCK_END });
            expect(emptyCalls.at(-1)![0].transport.isPlaying).toBe(false);
            expect(drained).toEqual([release]);

            // Drained: the pump stopped, it does not keep polling.
            const callsAfterDrain = vi.mocked(processYeastMidi).mock.calls.length;
            await vi.advanceTimersByTimeAsync(1_000);
            expect(vi.mocked(processYeastMidi).mock.calls.length).toBe(callsAfterDrain);
        } finally {
            vi.useRealTimers();
        }
    });

    /** A source note-on whose held lifetime keeps an idle pump draining. */
    function heldNoteOn(durationSamples: number): MidiEvent {
        return {
            timeSamples: 55_200,
            trackId: 'track-a',
            durationSamples,
            kind: { type: 'noteOn', channel: 2, note: 60, velocity: 96 },
        };
    }

    it('starts no drain without a drained-events callback', async () => {
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            if (input.events.length > 0) {
                return [heldNoteOn(33_600)];
            }
            return [];
        });

        await processRealtimeMidiInput(make_input());
        await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalledTimes(1));

        // The note-off ingress path passes no callback today; its behaviour is
        // unchanged: one block in, one block out.
        expect(vi.mocked(processYeastMidi).mock.calls).toHaveLength(1);
    });

    it('starts no drain while the transport is playing', async () => {
        const previous = transportStore.value;
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            if (input.events.length > 0) {
                return [heldNoteOn(3_360_000)];
            }
            return [];
        });
        try {
            await processRealtimeMidiInput(make_input({ onDrainedEvents: () => {} }));
            // While playing the scheduler owns block driving; a second driver
            // would double-process the rack.
            expect(vi.mocked(processYeastMidi).mock.calls).toHaveLength(1);
        } finally {
            transportStore.set(previous);
        }
    });

    it('supersedes the previous drain for the same rack route (#4870)', async () => {
        vi.useFakeTimers();
        try {
            // First drain chases an endless horizon and never drains on its own.
            vi.mocked(processYeastMidi).mockImplementation(async (input) => {
                if (input.events.length > 0) {
                    return [heldNoteOn(Number.MAX_SAFE_INTEGER / 2)];
                }
                return [];
            });
            const firstDrained: MidiEvent[] = [];
            await processRealtimeMidiInput(
                make_input({
                    onDrainedEvents: (events) => {
                        firstDrained.push(...events);
                    },
                })
            );
            await vi.advanceTimersByTimeAsync(0);
            const pumping = vi.mocked(processYeastMidi).mock.calls.length;
            expect(pumping).toBeGreaterThan(1);

            // A second input on the same rack route retires the first pump.
            vi.mocked(processYeastMidi).mockImplementation(async (input) => {
                if (input.events.length > 0) {
                    return [heldNoteOn(33_600)];
                }
                if (input.blockEndSamples >= 88_800) {
                    return [{ timeSamples: 88_800, kind: { type: 'noteOff', channel: 2, note: 60 } }];
                }
                return [];
            });
            await processRealtimeMidiInput(
                make_input({ noteInstanceId: 'realtime-voice-b', onDrainedEvents: () => {} })
            );
            await vi.runAllTimersAsync();

            const callsAtDrain = vi.mocked(processYeastMidi).mock.calls.length;
            await vi.advanceTimersByTimeAsync(1_000);
            expect(vi.mocked(processYeastMidi).mock.calls.length).toBe(callsAtDrain);
            expect(firstDrained).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});
