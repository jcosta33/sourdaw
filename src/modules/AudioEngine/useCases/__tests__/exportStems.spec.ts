import { describe, it, expect, beforeEach, vi } from 'vitest';

import { configureOfflineMidiEventProjection } from '../configureOfflineMidiEventProjection';
import { configureOfflinePpqEndpointProjection } from '../configureOfflinePpqEndpointProjection';
import { exportStems } from '../exportStems';
import { exportCancellationState } from '../offlineRender/exportCancellationState';

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
    connectOfflineToasterPadRoutes: vi.fn(),
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

vi.mock('../offlineRender/connectOfflineToasterPadRoutes', () => ({
    connectOfflineToasterPadRoutes: offlineRenderMocks.connectOfflineToasterPadRoutes,
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
        projectChordPitch: ({ pitch }: { pitch: number }) => pitch,
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
            createChordPitchProjector:
                () =>
                ({ pitch }) =>
                    pitch,
            evaluateAutomationValue: () => null,
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
            freezeState: { status: 'unfrozen' },
        };
        const ordinaryFolder = {
            id: 'ordinary-folder',
            kind: 'folder',
            disabled: false,
            devices: [],
        };
        const parentInput = {};
        const parentOutput = { connect: vi.fn() };
        const childOutput = { connect: vi.fn() };
        const renderedBuffer = { id: 'toaster-stem' };
        const allTracks = [toasterFolder, padChild, ordinaryFolder];
        const groupedTracks = [toasterFolder, padChild];
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(allTracks));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValueOnce({
            inputNode: parentInput,
            faderNode: {},
            panNode: {},
            outputNode: parentOutput,
            deviceEntries: [],
        });
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValueOnce({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode: childOutput,
            deviceEntries: [],
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue(renderedBuffer);
        const OfflineContext = vi.fn(function OfflineContext() {
            return { destination: {} };
        });
        vi.stubGlobal('OfflineAudioContext', OfflineContext);

        const stems = await exportStems(4);

        expect(OfflineContext).toHaveBeenCalledTimes(1);
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledTimes(2);
        // Stem path opts out of baked-in mute (M-037).
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledWith(expect.anything(), toasterFolder, {
            honorMuted: false,
        });
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledWith(expect.anything(), padChild, {
            honorMuted: false,
        });
        expect(offlineRenderMocks.connectOfflineToasterPadRoutes).toHaveBeenCalledWith(
            expect.objectContaining({ tracks: groupedTracks })
        );
        expect(childOutput.connect).toHaveBeenCalledWith(parentInput);
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ track: toasterFolder, allTracks: groupedTracks })
        );
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ track: { ...padChild, clips: [] }, allTracks: groupedTracks })
        );
        expect(stems).toEqual(new Map([['toaster-folder', renderedBuffer]]));
    });

    it('keeps a child stem when its Toaster-bearing parent cannot own a grouped stem', async () => {
        const dormantVca = {
            id: 'vca-1',
            kind: 'vca',
            disabled: false,
            devices: [{ id: 'd1', type: 'toaster' }],
        };
        const child = { id: 'midi-child', kind: 'midi', parentId: dormantVca.id, disabled: false, devices: [] };
        const renderedBuffer = { id: 'child-stem' };
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext([dormantVca, child]));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValue({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode: { connect: vi.fn() },
            deviceEntries: [],
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue(renderedBuffer);
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function OfflineContext() {
                return { destination: {} };
            })
        );

        const stems = await exportStems(4);

        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledTimes(1);
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledWith(expect.anything(), child, {
            honorMuted: false,
        });
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: child, allTracks: [child] })
        );
        expect(stems).toEqual(new Map([[child.id, renderedBuffer]]));
    });

    it('exports a seventeenth Toaster-folder child independently instead of dropping it', async () => {
        const toasterFolder = {
            id: 'toaster-folder',
            kind: 'folder',
            disabled: false,
            devices: [{ id: 'toaster-device', type: 'toaster' }],
        };
        const children = Array.from({ length: 17 }, (_, index) => ({
            id: `child-${index}`,
            kind: 'midi',
            parentId: toasterFolder.id,
            disabled: false,
            devices: [],
            freezeState: { status: 'unfrozen' },
        }));
        const renderedBuffer = { id: 'stem' };
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext([toasterFolder, ...children]));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValue({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode: { connect: vi.fn() },
            deviceEntries: [],
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue(renderedBuffer);
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function OfflineContext() {
                return { destination: {} };
            })
        );

        const stems = await exportStems(4);

        expect(stems.has(toasterFolder.id)).toBe(true);
        expect(stems.has(children[16]!.id)).toBe(true);
        expect(stems.size).toBe(2);
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: toasterFolder, allTracks: [toasterFolder, ...children.slice(0, 16)] })
        );
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: children[16], allTracks: [children[16]] })
        );
    });

    it('isolates each grouped stem to pads owned by its Toaster parent', async () => {
        const parentA = {
            id: 'toaster-a',
            kind: 'folder',
            disabled: false,
            devices: [{ id: 'toaster-device-a', type: 'toaster' }],
        };
        const parentB = {
            id: 'toaster-b',
            kind: 'folder',
            disabled: false,
            devices: [{ id: 'toaster-device-b', type: 'toaster' }],
        };
        const padA = {
            id: 'pad-a',
            kind: 'midi',
            parentId: parentA.id,
            disabled: false,
            devices: [],
            freezeState: { status: 'unfrozen' },
        };
        const padB = { ...padA, id: 'pad-b', parentId: parentB.id };
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext([parentA, padA, parentB, padB]));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValue({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode: { connect: vi.fn() },
            deviceEntries: [],
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue({ id: 'stem' });
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function OfflineContext() {
                return { destination: {} };
            })
        );

        await exportStems(4);

        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: parentA, allTracks: [parentA, padA] })
        );
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: parentB, allTracks: [parentB, padB] })
        );
    });

    it('keeps disabled pad placeholders so later pad indexes remain canonical', async () => {
        const parent = {
            id: 'toaster-parent',
            kind: 'folder',
            disabled: false,
            devices: [{ id: 'toaster-device', type: 'toaster' }],
        };
        const disabledPad = {
            id: 'pad-0',
            kind: 'midi',
            parentId: parent.id,
            disabled: true,
            devices: [],
            freezeState: { status: 'unfrozen' },
        };
        const activePad = { ...disabledPad, id: 'pad-1', disabled: false };
        const topology = [parent, disabledPad, activePad];
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(topology));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValue({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode: { connect: vi.fn() },
            deviceEntries: [],
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue({ id: 'stem' });
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function OfflineContext() {
                return { destination: {} };
            })
        );

        await exportStems(4);

        expect(offlineRenderMocks.createOfflineTrackStrip).not.toHaveBeenCalledWith(expect.anything(), disabledPad, {
            honorMuted: false,
        });
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledWith(expect.anything(), activePad, {
            honorMuted: false,
        });
        expect(offlineRenderMocks.connectOfflineToasterPadRoutes).toHaveBeenCalledWith(
            expect.objectContaining({ tracks: topology })
        );
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: parent, allTracks: topology })
        );
    });

    it('removes frozen pad clips from the parent view while rendering the child buffer once', async () => {
        const parent = {
            id: 'toaster-parent',
            kind: 'folder',
            disabled: false,
            devices: [{ id: 'toaster-device', type: 'toaster' }],
        };
        const clip = { id: 'stale-midi-clip' };
        const frozenPad = {
            id: 'frozen-pad',
            kind: 'midi',
            parentId: parent.id,
            disabled: false,
            devices: [],
            clips: [clip],
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buffer' },
        };
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext([parent, frozenPad]));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValue({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode: { connect: vi.fn() },
            deviceEntries: [],
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue({ id: 'stem' });
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function OfflineContext() {
                return { destination: {} };
            })
        );

        await exportStems(4);

        const frozenTopology = [parent, { ...frozenPad, clips: [] }];
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: parent, allTracks: frozenTopology })
        );
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenCalledWith(
            expect.objectContaining({ track: { ...frozenPad, clips: [] }, allTracks: frozenTopology })
        );
    });
});

// Option-parsing branches (object form vs number form), validation throws,
// the missing-projection guard, progress callbacks, and the cancel path.
describe('exportStems — option parsing, validation & control flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(null));
        configureOfflineMidiEventProjection({
            createProjector:
                () =>
                ({ events }) =>
                    events,
            selectProbability: () => true,
            createChordPitchProjector:
                () =>
                ({ pitch }) =>
                    pitch,
            evaluateAutomationValue: () => null,
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

    it('throws on invalid (non-positive) duration beats', async () => {
        await expect(exportStems(0)).rejects.toThrow(/Invalid export duration/);
        await expect(exportStems(-4)).rejects.toThrow(/Invalid export duration/);
        await expect(exportStems(Number.NaN)).rejects.toThrow(/Invalid export duration/);
    });

    it('parses the OfflineRenderOptions object form (sampleRate, startBeat, tailSeconds, callbacks)', async () => {
        const onProgress = vi.fn();
        const onWarning = vi.fn();
        // Empty tracks → returns early after parsing; assert resolveRenderContext
        // received the parsed values derived from the object form.
        const stems = await exportStems({
            durationBeats: 8,
            sampleRate: 48_000,
            startBeat: 2,
            tailSeconds: 1.5,
            onProgress,
            onWarning,
        });

        expect(stems.size).toBe(0);
        expect(offlineRenderMocks.resolveRenderContext).toHaveBeenCalledWith(
            expect.objectContaining({
                durationBeats: 8,
                sampleRate: 48_000,
                startBeat: 2,
                tailSeconds: 1.5,
            })
        );
        // Empty-tracks early-return calls onProgress(1).
        expect(onProgress).toHaveBeenCalledWith(1);
    });

    it('parses the number form with an explicit sampleRate override', async () => {
        await exportStems(4, 96_000);

        expect(offlineRenderMocks.resolveRenderContext).toHaveBeenCalledWith(
            expect.objectContaining({ durationBeats: 4, sampleRate: 96_000, startBeat: 0, tailSeconds: 0 })
        );
    });

    it('throws when offline musical projection is not configured', async () => {
        // Provide a context with tracks but null out the projection functions.
        const ctx = createRenderContext([{ id: 't1', kind: 'midi', disabled: false, devices: [] }]);
        (ctx as { projectMidiEvents: unknown }).projectMidiEvents = null;
        offlineRenderMocks.resolveRenderContext.mockReturnValue(ctx);

        await expect(exportStems(4)).rejects.toThrow('Offline musical projection is not configured');
    });

    it('skips the progress interval when onProgress is not provided (no-op timer path)', async () => {
        const track = { id: 't1', kind: 'midi', disabled: false, devices: [] };
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext([track]));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValue({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode: { connect: vi.fn() },
            deviceEntries: [],
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue({ id: 'stem' });
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function OfflineContext() {
                return { destination: {} };
            })
        );

        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        await exportStems(4); // no onProgress → stemTimer stays null

        // setInterval was never called for the stem progress simulator.
        expect(setIntervalSpy).not.toHaveBeenCalled();
        setIntervalSpy.mockRestore();
        vi.unstubAllGlobals();
    });

    it('runs the progress-easing interval and clears it after render when onProgress is set', async () => {
        vi.useFakeTimers();
        const track = { id: 't1', kind: 'midi', disabled: false, devices: [] };
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext([track]));
        offlineRenderMocks.createOfflineTrackStrip.mockResolvedValue({
            inputNode: {},
            faderNode: {},
            panNode: {},
            outputNode: { connect: vi.fn() },
            deviceEntries: [],
        });
        // Defer the render resolution so the interval ticks at least once.
        let resolveRender!: (v: unknown) => void;
        offlineRenderMocks.renderWithTimeout.mockReturnValue(
            new Promise((res) => {
                resolveRender = res;
            })
        );
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function OfflineContext() {
                return { destination: {} };
            })
        );

        const onProgress = vi.fn();
        const exportPromise = exportStems({ durationBeats: 4, onProgress });

        // Let the scheduling pass + interval registration settle, then tick
        // the interval so the progress-easing callback (lines 203-204) runs.
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(150); // > 100ms interval cadence

        // Resolve the render; the finally clears the interval (line 211).
        resolveRender({ id: 'stem' });
        await exportPromise;

        // The easing callback emitted intermediate progress values.
        expect(onProgress).toHaveBeenCalled();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('rejects when a cancel is requested before the render pool starts', async () => {
        const track = { id: 't1', kind: 'midi', disabled: false, devices: [] };
        // resolveRenderContext runs AFTER resetCancelFlag (line 38) clears the
        // flag, so setting it here as a side effect of resolving the context
        // makes the pool's isCancelRequested() guard (line 226) observe true.
        offlineRenderMocks.resolveRenderContext.mockImplementation(() => {
            exportCancellationState.cancelFlag = true;
            return createRenderContext([track]);
        });
        vi.stubGlobal(
            'OfflineAudioContext',
            vi.fn(function OfflineContext() {
                return { destination: {} };
            })
        );

        await expect(exportStems(4)).rejects.toThrow('Export cancelled');

        // Reset for subsequent tests.
        exportCancellationState.cancelFlag = false;
        vi.unstubAllGlobals();
    });
});
