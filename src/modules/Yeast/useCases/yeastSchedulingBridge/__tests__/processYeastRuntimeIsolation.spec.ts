import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const ensureRuntime = vi.hoisted(() => vi.fn(async () => ({ context: {} })));
const processRuntimeBlock = vi.hoisted(() => vi.fn(async () => []));
const setProjection = vi.hoisted(() => vi.fn());
const runtimeStatus = vi.hoisted(() => vi.fn(() => 'ready' as const));
const runtimeError = vi.hoisted(() => vi.fn(() => undefined));

vi.mock('../../../stores/yeastStore', () => ({
    yeastStore,
    getYeastRack: vi.fn(() => {
        throw new Error('main-thread MidiRack must not be requested');
    }),
}));

vi.mock('../../../engine/yeastRuntime', () => ({
    ensureYeastRuntime: ensureRuntime,
    getYeastRuntimeError: runtimeError,
    getYeastRuntimeStatus: runtimeStatus,
    processYeastRuntimeBlock: processRuntimeBlock,
    setYeastRuntimeProjection: setProjection,
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

describe('processYeastMidi — worklet-only runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        processRuntimeBlock.mockResolvedValue([
            { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } },
        ]);
    });

    it('publishes projection and processes only through the engine runtime boundary', async () => {
        const events = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 96 } }];

        await expect(
            processYeastMidi({
                context,
                events,
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).resolves.toEqual([{ timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 100 } }]);

        expect(setProjection).toHaveBeenCalledWith([
            {
                id: 'arp-1',
                type: 'arpeggiator',
                bypassed: false,
                params: { rate_denom: 16 },
            },
        ]);
        expect(ensureRuntime).toHaveBeenCalledWith({
            context,
            projection: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
        });
        expect(processRuntimeBlock).toHaveBeenCalledWith({
            context,
            events,
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
        });
    });

    it('returns authored events when the worklet runtime is unavailable', async () => {
        ensureRuntime.mockResolvedValue(null);
        const events = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 96 } }];

        await expect(
            processYeastMidi({
                context,
                events,
                blockStartSamples: 0,
                blockEndSamples: 128,
                transport,
            })
        ).resolves.toEqual(events);
        expect(processRuntimeBlock).not.toHaveBeenCalled();
    });
});
