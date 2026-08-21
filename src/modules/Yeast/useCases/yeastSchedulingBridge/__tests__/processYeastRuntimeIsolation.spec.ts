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
const isPreviewCaptureEnabled = vi.hoisted(() => vi.fn(() => false));

vi.mock('../../../stores/yeastStore', () => ({
    yeastStore,
    // Rack reads are per device instance (issue #2422): a named rack resolves
    // to that device's stored state. The old guard name (`getYeastRack`, a
    // main-thread MidiRack request) is gone with the engine isolation work.
    readYeastRack: () => yeastStore.value,
}));

vi.mock('../../../engine/yeastRuntime', () => ({
    getYeastRuntimeError: runtimeError,
    getYeastRuntimeStatus: runtimeStatus,
    processYeastRuntimeTransaction: processRuntimeTransaction,
    resetYeastRuntimePreview: resetRuntimePreview,
}));

vi.mock('../../../engine/yeastPreviewTap', () => ({
    yeastPreviewTap: { isEnabled: isPreviewCaptureEnabled },
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
        isPreviewCaptureEnabled.mockReturnValue(false);
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

    it('routes an empty rack through the runtime so default-state preview is published with audible pass-through', async () => {
        yeastStore.value = { processors: [], uiLevel: 1 };
        isPreviewCaptureEnabled.mockReturnValueOnce(true);
        const events = [{ timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 96 } }];
        processRuntimeTransaction.mockResolvedValueOnce(events);

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

        expect(processRuntimeTransaction).toHaveBeenCalledWith({
            context,
            rackId: 'rack-a',
            routeId: 'route-a',
            trackId: 'track-a',
            events,
            blockStartSamples: 0,
            blockEndSamples: 128,
            transport,
            projection: [],
        });
        expect(resetRuntimePreview).not.toHaveBeenCalled();
    });
});
