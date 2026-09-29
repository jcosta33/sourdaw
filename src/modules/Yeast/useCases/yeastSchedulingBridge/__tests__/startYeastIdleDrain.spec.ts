import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { processYeastMidi } from '../processYeastMidi';
import { MAX_DRAIN_TICKS, startYeastIdleDrain } from '../startYeastIdleDrain';

import type { MidiEvent, TransportInfo } from '../../../models/MidiEvent';

vi.mock('../processYeastMidi', () => ({
    processYeastMidi: vi.fn(),
}));

const TRANSPORT: TransportInfo = {
    sampleRate: 48_000,
    bpm: 120,
    ppqPosition: 1,
    isPlaying: false,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

const RELEASE: MidiEvent = {
    timeSamples: 88_800,
    kind: { type: 'noteOff', channel: 2, note: 60 },
};

type DrainInput = Parameters<typeof startYeastIdleDrain>[0];

function make_input(overrides: Partial<DrainInput> = {}): DrainInput {
    return {
        context: {} as BaseAudioContext,
        rackId: 'rack-a',
        routeId: 'track-a',
        trackId: 'track-a',
        transport: TRANSPORT,
        firstBlockEndSamples: 60_000,
        horizonSamples: 88_800,
        strideSamples: 4_800,
        onEvents: () => {},
        ...overrides,
    };
}

/** Queue-driven tick seam: each scheduled callback is parked for the spec to run. */
function manualTicks(): { scheduleTick: DrainInput['scheduleTick']; next: () => Promise<() => void> } {
    const ticks: Array<() => void> = [];
    return {
        scheduleTick: (callback) => {
            ticks.push(callback);
            return () => {};
        },
        next: async () => {
            await vi.waitFor(() => expect(ticks.length).toBeGreaterThan(0));
            return ticks.shift()!;
        },
    };
}

/** Run one pump round: fire the parked tick and wait for its worker call. */
async function pumpRound(ticks: ReturnType<typeof manualTicks>, expectedCalls: number): Promise<void> {
    const tick = await ticks.next();
    tick();
    await vi.waitFor(() => expect(processYeastMidi).toHaveBeenCalledTimes(expectedCalls));
}

/**
 * Fast driver for long pumps: fire the parked tick and flush the round's
 * microtasks. The mocked worker resolves without I/O, so a few resolved-promise
 * awaits run the full `.then` including its next `scheduleTick`.
 */
async function flushRound(parked: Array<() => void>): Promise<void> {
    const tick = parked.shift();
    expect(tick).toBeDefined();
    tick!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('startYeastIdleDrain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('processes advancing empty blocks and dispatches their events until quiet past the horizon', async () => {
        const drained: Array<readonly MidiEvent[]> = [];
        let released = false;
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            if (!released && input.blockEndSamples >= 88_800) {
                released = true;
                return [RELEASE];
            }
            return [];
        });
        const ticks = manualTicks();
        const cancel = startYeastIdleDrain(
            make_input({
                scheduleTick: ticks.scheduleTick,
                onEvents: (events) => {
                    drained.push(events);
                },
            })
        );
        try {
            const firstWindowEnd = 60_000 + 4_800;
            await pumpRound(ticks, 1);
            expect(vi.mocked(processYeastMidi)).toHaveBeenLastCalledWith(
                expect.objectContaining({ events: [], blockStartSamples: 60_000, blockEndSamples: firstWindowEnd })
            );
            expect(drained).toEqual([]);

            // Quiet rounds advance the window by one stride until the round
            // whose end covers the release emits it.
            let calls = 1;
            while (drained.length === 0) {
                calls += 1;
                await pumpRound(ticks, calls);
            }
            expect(drained).toEqual([[RELEASE]]);
            const releasingWindow = vi.mocked(processYeastMidi).mock.calls[calls - 1]![0];
            expect(releasingWindow.blockEndSamples).toBeGreaterThanOrEqual(88_800);
            expect(releasingWindow.blockStartSamples).toBeLessThan(88_800);

            // One more quiet round past the horizon, then the pump stops: no
            // further tick is scheduled.
            await pumpRound(ticks, calls + 1);
            await expect(ticks.next()).rejects.toThrow();
        } finally {
            cancel();
        }
    });

    it('extends the horizon when a drained batch carries a longer note lifetime', async () => {
        const extended: MidiEvent = {
            timeSamples: 70_000,
            durationSamples: 20_000,
            kind: { type: 'noteOn', channel: 2, note: 64, velocity: 96 },
        };
        let extendedEmitted = false;
        let released = false;
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            if (!released && input.blockEndSamples >= 90_000) {
                released = true;
                return [RELEASE];
            }
            if (!extendedEmitted && input.blockEndSamples >= 64_800) {
                extendedEmitted = true;
                return [extended];
            }
            return [];
        });
        const drained: Array<readonly MidiEvent[]> = [];
        const ticks = manualTicks();
        const cancel = startYeastIdleDrain(
            make_input({
                scheduleTick: ticks.scheduleTick,
                onEvents: (events) => {
                    drained.push(events);
                },
            })
        );
        try {
            // Without the extension the pump would stop once its original
            // 88_800 horizon was covered; the extended lifetime pushes the
            // horizon to 90_000 and the pump must run past that instead.
            let calls = 0;
            while (drained.length < 2) {
                calls += 1;
                expect(calls).toBeLessThan(12);
                await pumpRound(ticks, calls);
            }
            expect(drained).toEqual([[extended], [RELEASE]]);
            await pumpRound(ticks, calls + 1);
            await expect(ticks.next()).rejects.toThrow();
        } finally {
            cancel();
        }
    });

    it('retires the previous drain for the same rack route when a new one starts', async () => {
        vi.mocked(processYeastMidi).mockResolvedValue([]);
        const ticks = manualTicks();
        startYeastIdleDrain(make_input({ scheduleTick: ticks.scheduleTick }));
        // Parked but never fired: this is the pump the next drain retires.
        const retiredTick = await ticks.next();

        const cancelSecond = startYeastIdleDrain(make_input({ scheduleTick: ticks.scheduleTick }));
        try {
            retiredTick();
            await Promise.resolve();
            await Promise.resolve();
            expect(processYeastMidi).not.toHaveBeenCalled();
        } finally {
            cancelSecond();
        }
    });

    it('delivers an in-flight batch to onEvents even when superseded mid-op', async () => {
        const resolvers: Array<(events: MidiEvent[]) => void> = [];
        vi.mocked(processYeastMidi).mockImplementation(
            () =>
                new Promise<MidiEvent[]>((resolve) => {
                    resolvers.push(resolve);
                })
        );
        const ticks = manualTicks();
        const drained: Array<readonly MidiEvent[]> = [];
        startYeastIdleDrain(
            make_input({
                scheduleTick: ticks.scheduleTick,
                onEvents: (events) => {
                    drained.push(events);
                },
            })
        );
        await pumpRound(ticks, 1);

        // A new input on the same route retires pump 1 while its worker op is
        // still in flight.
        const cancelSecond = startYeastIdleDrain(make_input({ scheduleTick: ticks.scheduleTick }));
        try {
            // The rack already dequeued this batch from every queue and can
            // never re-emit it; supersession retires the continuation, not
            // the batch.
            resolvers[0]!([RELEASE]);
            await Promise.resolve();
            await Promise.resolve();
            expect(drained).toEqual([[RELEASE]]);

            // Retirement only ends pump 1: the superseding pump keeps
            // draining its own windows.
            await pumpRound(ticks, 2);
            resolvers[1]!([]);
            await Promise.resolve();
            await Promise.resolve();
            await pumpRound(ticks, 3);
        } finally {
            cancelSecond();
        }
    });

    it('drops the pending tick when cancelled', async () => {
        vi.mocked(processYeastMidi).mockResolvedValue([]);
        const ticks = manualTicks();
        const cancel = startYeastIdleDrain(make_input({ scheduleTick: ticks.scheduleTick }));

        cancel();
        const tick = await ticks.next();
        tick();
        await Promise.resolve();
        await Promise.resolve();
        expect(processYeastMidi).not.toHaveBeenCalled();
    });

    it('stops without processing when the transport starts playing', async () => {
        vi.mocked(processYeastMidi).mockResolvedValue([]);
        const ticks = manualTicks();
        const cancel = startYeastIdleDrain(make_input({ scheduleTick: ticks.scheduleTick }));
        const previous = transportStore.value;
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        try {
            const tick = await ticks.next();
            tick();
            await Promise.resolve();
            await Promise.resolve();
            // The scheduler owns block driving while playing.
            expect(processYeastMidi).not.toHaveBeenCalled();
        } finally {
            transportStore.set(previous);
            cancel();
        }
    });

    it('drains a reachable long-tail repeater horizon to completion', async () => {
        // UI-reachable repeater tail (#4870): 20 BPM (MIN_TEMPO), rate_denom
        // 24 → interval 4/24 beat = 0.5 s, repeat_count 16, gate 2.0 → the
        // final note-off lands 16 × 0.5 s + 1 s ≈ 9 s after the struck note.
        // At the 0.1 s drain stride that tail needs ≈ 90 windows; a fixed
        // 64-tick cap retired the pump mid-tail and stranded the voiced
        // repeat's note-off.
        const horizonSamples = 9 * 48_000;
        const finalRelease: MidiEvent = {
            timeSamples: horizonSamples,
            kind: { type: 'noteOff', channel: 2, note: 60 },
        };
        let released = false;
        vi.mocked(processYeastMidi).mockImplementation(async (input) => {
            if (!released && input.blockEndSamples >= horizonSamples) {
                released = true;
                return [finalRelease];
            }
            return [];
        });
        const drained: Array<readonly MidiEvent[]> = [];
        const parked: Array<() => void> = [];
        const cancel = startYeastIdleDrain(
            make_input({
                firstBlockEndSamples: 4_800,
                horizonSamples,
                scheduleTick: (callback) => {
                    parked.push(callback);
                    return () => {};
                },
                onEvents: (events) => {
                    drained.push(events);
                },
            })
        );
        try {
            let rounds = 0;
            while (drained.length === 0) {
                rounds += 1;
                expect(rounds).toBeLessThanOrEqual(120);
                await flushRound(parked);
            }
            // The release only becomes reachable in window 89; delivering it
            // proves the pump covered the whole reachable tail.
            expect(rounds).toBe(89);
            expect(drained).toEqual([[finalRelease]]);
            // One quiet confirmation round past the horizon, then retirement.
            await flushRound(parked);
            expect(processYeastMidi).toHaveBeenCalledTimes(90);
            expect(parked.length).toBe(0);
        } finally {
            cancel();
        }
    });

    it('still retires when the horizon extends without end, at the absolute ceiling', async () => {
        // Every batch carries a lifetime that pushes the horizon far past the
        // windows, so the horizon-derived bound recomputes past the ceiling on
        // every round; only the absolute ceiling may end the pump (#4870).
        vi.mocked(processYeastMidi).mockImplementation(async (input) => [
            {
                timeSamples: input.blockEndSamples,
                durationSamples: 1_000_000_000,
                kind: { type: 'noteOn', channel: 2, note: 60, velocity: 96 },
            },
        ]);
        const drained: Array<readonly MidiEvent[]> = [];
        const parked: Array<() => void> = [];
        const cancel = startYeastIdleDrain(
            make_input({
                scheduleTick: (callback) => {
                    parked.push(callback);
                    return () => {};
                },
                onEvents: (events) => {
                    drained.push(events);
                },
            })
        );
        try {
            for (let round = 1; round <= MAX_DRAIN_TICKS; round++) {
                await flushRound(parked);
            }
            // The ceiling retires the pump at entry on the round after the
            // last allowed one: exactly MAX_DRAIN_TICKS windows processed.
            expect(processYeastMidi).toHaveBeenCalledTimes(MAX_DRAIN_TICKS);
            const ceilingRound = parked.shift()!;
            ceilingRound();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            expect(processYeastMidi).toHaveBeenCalledTimes(MAX_DRAIN_TICKS);
            expect(parked.length).toBe(0);
        } finally {
            cancel();
        }
    });
});
