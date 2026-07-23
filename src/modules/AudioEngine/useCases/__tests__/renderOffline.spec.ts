import { describe, it, expect, beforeEach, vi } from 'vitest';

import { renderOffline } from '../renderOffline';

const offlineRenderMocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(() => null),
    getMidiStoreState: vi.fn(() => null),
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
    resolveRenderContext: vi.fn(),
    createOfflineTrackStrip: vi.fn(),
    renderWithTimeout: vi.fn(),
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

vi.mock('../offlineRender/resolveRenderContext', () => ({
    resolveRenderContext: offlineRenderMocks.resolveRenderContext,
}));

vi.mock('../offlineRender/createOfflineTrackStrip', () => ({
    createOfflineTrackStrip: offlineRenderMocks.createOfflineTrackStrip,
}));

vi.mock('../offlineRender/renderWithTimeout', () => ({
    renderWithTimeout: offlineRenderMocks.renderWithTimeout,
}));

describe('renderOffline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects non-positive duration before touching stores', async () => {
        await expect(renderOffline(0)).rejects.toThrow();
        expect(offlineRenderMocks.getTrackStoreState).not.toHaveBeenCalled();
    });

    it('allocates no offline strip for a dormant VCA, including Toaster residue', async () => {
        offlineRenderMocks.resolveRenderContext.mockReturnValue({
            tracks: {
                tracks: [
                    {
                        id: 'vca-1',
                        kind: 'vca',
                        disabled: false,
                        muted: false,
                        devices: [{ id: 'd1', type: 'toaster' }],
                    },
                ],
            },
            midi: {},
            transport: null,
            defaultTempo: 120,
            changes: [],
            durationSeconds: 1,
            projectMidiEvents: vi.fn(),
            selectMidiEventProbability: vi.fn(() => true),
            projectChordPitch: ({ pitch }: { pitch: number }) => pitch,
            projectPpqEndpoints: vi.fn(),
            processYeastMidi: vi.fn(),
        });
        const rendered = { sampleRate: 44_100 };
        offlineRenderMocks.renderWithTimeout.mockResolvedValue(rendered);
        class TestOfflineAudioContext {
            readonly destination = {};

            createGain() {
                return { gain: { value: 0 }, connect: vi.fn() };
            }
        }
        vi.stubGlobal('OfflineAudioContext', TestOfflineAudioContext);

        const result = await renderOffline(4);

        expect(result).toBe(rendered);
        expect(offlineRenderMocks.createOfflineTrackStrip).not.toHaveBeenCalled();
    });
});
