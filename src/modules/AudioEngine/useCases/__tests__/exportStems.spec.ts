import { describe, it, expect, beforeEach, vi } from 'vitest';

import { configureOfflineMidiEventProjection } from '../configureOfflineMidiEventProjection';
import { configureOfflinePpqEndpointProjection } from '../configureOfflinePpqEndpointProjection';
import { exportStems } from '../exportStems';

const offlineRenderMocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => unknown>(() => null),
    getMidiStoreState: vi.fn<() => unknown>(() => null),
    getTransportStoreValue: vi.fn(() => null),
    getTempoMapState: vi.fn(() => null),
    getAutomationLanes: vi.fn(() => []),
    audioBufferCache: { get: vi.fn(() => undefined) },
    buildDeviceChain: vi.fn(() => Promise.resolve([])),
    resolveClipsWithComping: vi.fn(() => []),
    beatToSeconds: vi.fn(() => 0),
    resolveDrumKit: vi.fn(() => null),
    scheduleTrackAutomation: vi.fn(),
    scheduleNoteOffline: vi.fn(),
    getSynthParamsFromDevices: vi.fn(() => null),
    scheduleKitNote: vi.fn(),
    getDrumKitDefByIndex: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        resolveClipsWithComping: offlineRenderMocks.resolveClipsWithComping,
        getTrackStoreState: offlineRenderMocks.getTrackStoreState,
    };
});

vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        ...actual,
        getAutomationLanes: offlineRenderMocks.getAutomationLanes,
    };
});

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    return {
        ...actual,
        getMidiStoreState: offlineRenderMocks.getMidiStoreState,
    };
});

vi.mock('#/modules/Synth/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/useCases')>();
    return {
        ...actual,
        getDrumKitDefByIndex: offlineRenderMocks.getDrumKitDefByIndex,
        getSynthParamsFromDevices: offlineRenderMocks.getSynthParamsFromDevices,
        scheduleDrumKitNote: offlineRenderMocks.scheduleDrumKitNote,
        scheduleKitNote: offlineRenderMocks.scheduleKitNote,
        scheduleNoteOffline: offlineRenderMocks.scheduleNoteOffline,
    };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        getTempoMapState: offlineRenderMocks.getTempoMapState,
        getTransportStoreValue: offlineRenderMocks.getTransportStoreValue,
    };
});

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: offlineRenderMocks.audioBufferCache,
}));

vi.mock('../buildDeviceChain', () => ({
    buildDeviceChain: offlineRenderMocks.buildDeviceChain,
}));

vi.mock('#/modules/AudioEngine/services/beatConversion', () => ({
    beatToSeconds: offlineRenderMocks.beatToSeconds,
}));

vi.mock('#/modules/AudioEngine/services/deviceResolution', () => ({
    resolveDrumKit: offlineRenderMocks.resolveDrumKit,
}));

vi.mock('../../repositories/offlineScheduler/automationScheduling', () => ({
    scheduleTrackAutomation: offlineRenderMocks.scheduleTrackAutomation,
}));

describe('exportStems', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureOfflineMidiEventProjection({
            createProjector:
                () =>
                ({ events }) =>
                    events,
            selectProbability: () => true,
        });
        configureOfflinePpqEndpointProjection({
            project: ({ startPpq, endPpq, sampleRate }) => ({
                startSamples: startPpq * sampleRate,
                endSamples: endPpq * sampleRate,
                durationSamples: (endPpq - startPpq) * sampleRate,
                startSeconds: startPpq,
                endSeconds: endPpq,
                durationSeconds: endPpq - startPpq,
            }),
        });
    });

    it('returns empty map when track or midi state is missing', async () => {
        const stems = await exportStems(4);
        expect(stems.size).toBe(0);
    });

    it('emits no stem or offline context for a dormant VCA, including Toaster residue', async () => {
        offlineRenderMocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'vca-1',
                    kind: 'vca',
                    disabled: false,
                    muted: false,
                    devices: [{ id: 'd1', type: 'toaster' }],
                },
            ],
        });
        offlineRenderMocks.getMidiStoreState.mockReturnValue({ notesByClipId: {}, probabilitySeed: 1 });
        const OfflineContext = vi.fn();
        vi.stubGlobal('OfflineAudioContext', OfflineContext);

        const stems = await exportStems(4);

        expect(stems.size).toBe(0);
        expect(OfflineContext).not.toHaveBeenCalled();
    });
});
