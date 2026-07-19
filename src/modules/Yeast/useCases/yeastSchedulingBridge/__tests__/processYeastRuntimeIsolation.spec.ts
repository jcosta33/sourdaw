import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MidiEvent } from '../../../models/MidiEvent';

const yeastStore = vi.hoisted(() => ({
    value: {
        processors: [
            {
                id: 'arp-1',
                type: 'arpeggiator' as const,
                name: 'Arpeggiator',
                bypassed: false,
                params: { rate_denom: 16 },
            },
        ],
        uiLevel: 1 as const,
    },
    set: vi.fn(),
}));

const processRuntimeTransaction = vi.hoisted(() =>
    vi.fn<(input: unknown) => Promise<MidiEvent[] | null>>(() => Promise.resolve([]))
);
const runtimeStatus = vi.hoisted(() => vi.fn(() => 'ready' as const));
const runtimeError = vi.hoisted(() => vi.fn(() => undefined));
const resetRuntimePreview = vi.hoisted(() => vi.fn());

vi.mock('../../../stores/yeastStore', () => ({
    yeastStore,
    getYeastRack: vi.fn(() => {
        throw new Error('main-thread MidiRack must not be requested');
    }),
}));

vi.mock('../../../engine/yeastRuntime', () => ({
    getYeastRuntimeError: runtimeError,
    getYeastRuntimeStatus: runtimeStatus,
    processYeastRuntimeTransaction: processRuntimeTransaction,
    resetYeastRuntimePreview: resetRuntimePreview,
}));

const { processYeastMidi } = await import('../processYeastMidi');

const context = {} as BaseAudioContext;
const transport = {
    sampleRate: 48000,
    bpm: 120,
    ppqPosition: 0,
    isPlaying: true,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

describe('processYeastMidi — Worker-only runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        processRuntimeTransaction.mockResolvedValue([
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
        ]);
    });

    it('publishes projection and processes only through the engine runtime boundary', async () => {
        const events = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 96 } }];

        await expect(
            processYeastMidi({
                context,
                trackId: 'track-a',
                events,
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).resolves.toEqual([{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } }]);

        expect(processRuntimeTransaction).toHaveBeenCalledWith({
            context,
            rackId: 'track-a',
            routeId: 'track-a',
            trackId: 'track-a',
            events,
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
            projection: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
        });
    });

    it('returns authored events when the Worker runtime is unavailable', async () => {
        processRuntimeTransaction.mockResolvedValue(null);
        const events = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 96 } }];

        await expect(
            processYeastMidi({
                context,
                trackId: 'track-a',
                events,
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).resolves.toEqual(events);
        expect(processRuntimeTransaction).toHaveBeenCalledTimes(1);
    });

    it('passes authored events through when the Worker dies during processing', async () => {
        processRuntimeTransaction.mockRejectedValueOnce(new Error('Worker crashed'));
        const events = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 96 } }];

        await expect(
            processYeastMidi({
                context,
                trackId: 'track-a',
                events,
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).resolves.toEqual(events);
        expect(processRuntimeTransaction).toHaveBeenCalledTimes(1);
    });

    it('publishes a route reset before bypassing an empty rack', async () => {
        yeastStore.value = { processors: [], uiLevel: 1 };
        const events = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 96 } }];

        await expect(
            processYeastMidi({
                context,
                rackId: 'rack-a',
                routeId: 'route-a',
                trackId: 'track-a',
                events,
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).resolves.toEqual(events);

        expect(resetRuntimePreview).toHaveBeenCalledWith({
            rackId: 'rack-a',
            routeId: 'route-a',
            trackId: 'track-a',
        });
        expect(processRuntimeTransaction).not.toHaveBeenCalled();
    });
});
