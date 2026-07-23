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
    createOfflineTrackStrip: vi.fn(),
    renderWithTimeout: vi.fn(),
    resolveRenderContext: vi.fn(),
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

vi.mock('../offlineRender/createOfflineTrackStrip', () => ({
    createOfflineTrackStrip: offlineRenderMocks.createOfflineTrackStrip,
}));

vi.mock('../offlineRender/renderWithTimeout', () => ({
    renderWithTimeout: offlineRenderMocks.renderWithTimeout,
}));

vi.mock('../offlineRender/resolveRenderContext', () => ({
    resolveRenderContext: offlineRenderMocks.resolveRenderContext,
}));

vi.mock('../offlineRender/scheduleTrackClips', () => ({
    scheduleTrackClips: offlineRenderMocks.scheduleTrackClips,
}));

function createRenderContext(tracks: unknown[] | null) {
    return {
        tracks: tracks ? { selectedTrackId: null, tracks } : null,
        midi: tracks ? { notesByClipId: {}, probabilitySeed: 1 } : null,
        transport: null,
        defaultTempo: 120,
        changes: [],
        startBeat: 0,
        durationSeconds: 1,
        tailSeconds: 0,
        projectMidiEvents: vi.fn(),
        selectMidiEventProbability: vi.fn(() => true),
        projectPpqEndpoints: vi.fn(),
        processYeastMidi: null,
    };
}

describe('exportStems', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(null));
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
        const dormantVca = {
            id: 'vca-1',
            kind: 'vca',
            disabled: false,
            muted: false,
            devices: [{ id: 'd1', type: 'toaster' }],
        };
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext([dormantVca]));
        const OfflineContext = vi.fn();
        vi.stubGlobal('OfflineAudioContext', OfflineContext);

        const stems = await exportStems(4);

        expect(stems.size).toBe(0);
        expect(OfflineContext).not.toHaveBeenCalled();
    });

    it('exports one grouped Toaster stem with its pad children while excluding duplicate child stems', async () => {
        const toasterFolder = {
            id: 'toaster-folder',
            kind: 'folder',
            disabled: false,
            devices: [{ id: 'toaster-device', type: 'toaster' }],
        };
        const padChild = {
            id: 'kick-pad',
            kind: 'midi',
            parentId: toasterFolder.id,
            disabled: false,
            devices: [],
        };
        const ordinaryFolder = {
            id: 'ordinary-folder',
            kind: 'folder',
            disabled: false,
            devices: [],
        };
        const outputNode = { connect: vi.fn() };
        const renderedBuffer = { id: 'toaster-stem' };
        const allTracks = [toasterFolder, padChild, ordinaryFolder];
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(allTracks));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValue({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode,
            deviceEntries: [],
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue(renderedBuffer);
        const OfflineContext = vi.fn(function OfflineContext() {
            return { destination: {} };
        });
        vi.stubGlobal('OfflineAudioContext', OfflineContext);

        const stems = await exportStems(4);

        expect(OfflineContext).toHaveBeenCalledTimes(1);
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledTimes(1);
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledWith(expect.anything(), toasterFolder);
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: toasterFolder, allTracks })
        );
        expect(stems).toEqual(new Map([['toaster-folder', renderedBuffer]]));
    });
});
