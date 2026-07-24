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
    scheduleTrackClips: vi.fn(),
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

vi.mock('../offlineRender/scheduleTrackClips', () => ({
    scheduleTrackClips: offlineRenderMocks.scheduleTrackClips,
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

describe('renderOffline effective audibility (OE-4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const audioTrack = (over: { id: string; soloed?: boolean; muted?: boolean }) => ({
        id: over.id,
        kind: 'audio',
        disabled: false,
        muted: over.muted ?? false,
        soloed: over.soloed ?? false,
        soloSafe: false,
        outputId: 'hw_out',
        devices: [],
        sends: [],
    });

    const renderContext = (tracks: ReturnType<typeof audioTrack>[]) => ({
        tracks: { tracks },
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

    function primeRender(): void {
        offlineRenderMocks.createOfflineTrackStrip.mockImplementation(() =>
            Promise.resolve({
                inputNode: { connect: vi.fn() },
                preFaderTap: { connect: vi.fn() },
                faderNode: { connect: vi.fn() },
                postFaderGain: { connect: vi.fn() },
                panNode: { connect: vi.fn() },
                outputNode: { connect: vi.fn() },
                deviceEntries: [],
            })
        );
        offlineRenderMocks.renderWithTimeout.mockResolvedValue({ sampleRate: 44_100 });
        class TestOfflineAudioContext {
            readonly destination = {};

            createGain() {
                return { gain: { value: 0 }, connect: vi.fn() };
            }
        }
        vi.stubGlobal('OfflineAudioContext', TestOfflineAudioContext);
    }

    const scheduledTrackIds = (): string[] =>
        offlineRenderMocks.scheduleTrackClips.mock.calls.map((call) => call[0].track.id);

    it('schedules only the soloed track, dropping non-soloed content, when a solo is engaged', async () => {
        offlineRenderMocks.resolveRenderContext.mockReturnValue(
            renderContext([audioTrack({ id: 'solo', soloed: true }), audioTrack({ id: 'other' })])
        );
        primeRender();

        await renderOffline(4);

        expect(scheduledTrackIds()).toEqual(['solo']);
    });

    it('schedules every non-muted track when nothing is soloed', async () => {
        offlineRenderMocks.resolveRenderContext.mockReturnValue(
            renderContext([audioTrack({ id: 'a' }), audioTrack({ id: 'b', muted: true }), audioTrack({ id: 'c' })])
        );
        primeRender();

        await renderOffline(4);

        expect(scheduledTrackIds()).toEqual(['a', 'c']);
    });
});
