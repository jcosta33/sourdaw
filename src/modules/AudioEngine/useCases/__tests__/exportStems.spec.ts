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
    sidechainStore: { value: { routes: [] as Array<Record<string, unknown>> } },
    connectOfflineSidechainRoutes: vi.fn(),
    prepareOfflineSidechainCompressor: vi.fn(() => Promise.resolve()),
    getSidechainKeyDelay: vi.fn(() => 0),
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

vi.mock('#/modules/Routing/stores', () => ({
    sidechainStore: offlineRenderMocks.sidechainStore,
}));

vi.mock('../../repositories/offlineRouting/connectOfflineSidechainRoutes', () => ({
    connectOfflineSidechainRoutes: offlineRenderMocks.connectOfflineSidechainRoutes,
}));

vi.mock('../../repositories/devices/dynamics/prepareOfflineSidechainCompressor', () => ({
    prepareOfflineSidechainCompressor: offlineRenderMocks.prepareOfflineSidechainCompressor,
}));

vi.mock('../latencyCompensation/compensation/getSidechainKeyDelay', () => ({
    getSidechainKeyDelay: offlineRenderMocks.getSidechainKeyDelay,
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
        resolveTempoAtBeat: ({ defaultTempo: tempo }: { defaultTempo: number }) => tempo,
        processYeastMidi: null,
    };
}

describe('exportStems', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(null));
        offlineRenderMocks.sidechainStore.value = { routes: [] };
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
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
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
        // Stem path opts out of baked-in mute (M-037); neither track is in a VCA
        // group, so the group master resolves to a no-op multiplier.
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledWith(expect.anything(), toasterFolder, {
            honorMuted: false,
            vcaMultiplier: 1,
        });
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledWith(expect.anything(), padChild, {
            honorMuted: false,
            vcaMultiplier: 1,
        });
        expect(offlineRenderMocks.connectOfflineToasterPadRoutes).toHaveBeenCalledWith(
            expect.objectContaining({ tracks: groupedTracks })
        );
        expect(childOutput.connect).toHaveBeenCalledWith(parentInput);
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ track: toasterFolder, allTracks: groupedTracks, honorMuted: false })
        );
        expect(offlineRenderMocks.scheduleTrackClips).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ track: { ...padChild, clips: [] }, allTracks: groupedTracks, honorMuted: false })
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
            vcaMultiplier: 1,
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

        // Matched on any options, so this stays a claim about the pad never being
        // stripped rather than one about the options object's exact shape.
        expect(offlineRenderMocks.createOfflineTrackStrip).not.toHaveBeenCalledWith(
            expect.anything(),
            disabledPad,
            expect.anything()
        );
        expect(offlineRenderMocks.createOfflineTrackStrip).toHaveBeenCalledWith(expect.anything(), activePad, {
            honorMuted: false,
            vcaMultiplier: 1,
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

    // FX-9 — a sidechain compressor is an insert on the stem's *own* track, so its
    // ducking is part of that track's processed output. Each stem renders in its
    // own OfflineAudioContext holding only that track, so the key source was
    // absent and the compressor ran with a dead sidechain input: the stem carried
    // the compressor but none of its gain reduction, and no sum of the stems could
    // reproduce the mixdown. The key source is now built into the stem's context
    // as a silent auxiliary — it drives the detector and never reaches the output.
    describe('sidechain keys in stems (FX-9)', () => {
        const compressorDevice = { id: 'comp-1', type: 'builtin-sidechain-compressor', bypassed: false };

        const keyedPair = () => [
            {
                id: 'kick',
                kind: 'audio',
                disabled: false,
                muted: false,
                devices: [],
                freezeState: { status: 'unfrozen' },
            },
            {
                id: 'bass',
                kind: 'audio',
                disabled: false,
                muted: false,
                devices: [compressorDevice],
                freezeState: { status: 'unfrozen' },
            },
        ];

        function primeStemRender() {
            offlineRenderMocks.buildDeviceChain.mockResolvedValue([]);
            offlineRenderMocks.createOfflineTrackStrip.mockImplementation(() =>
                Promise.resolve({
                    inputNode: { connect: vi.fn() },
                    preFaderTap: { connect: vi.fn() },
                    faderNode: {},
                    postFaderGain: {},
                    panNode: {},
                    outputNode: { connect: vi.fn() },
                    deviceEntries: [],
                })
            );
            offlineRenderMocks.renderWithTimeout.mockResolvedValue({ id: 'stem' });
            vi.stubGlobal(
                'OfflineAudioContext',
                vi.fn(function OfflineContext() {
                    return { destination: { id: 'destination' } };
                })
            );
        }

        const stripsForStem = (stemTrackId: string) =>
            offlineRenderMocks.connectOfflineSidechainRoutes.mock.calls
                .map((call) => call[0] as { trackStripsById: Map<string, unknown> })
                .find((input) => input.trackStripsById.has(stemTrackId))?.trackStripsById;

        const scheduleCountFor = (trackId: string) =>
            offlineRenderMocks.scheduleTrackClips.mock.calls.filter(
                (call) => (call[0] as { track: { id: string } }).track.id === trackId
            ).length;

        it('wires the key source into the keyed track’s stem so its ducking survives the export', async () => {
            offlineRenderMocks.sidechainStore.value = {
                routes: [{ sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'comp-1' }],
            };
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(keyedPair()));
            primeStemRender();

            await exportStems(4);

            const bassStrips = stripsForStem('bass');
            expect(bassStrips?.has('kick')).toBe(true);
            // 'kick' is scheduled twice: once as its own stem, once as the key
            // driving the compressor in the 'bass' stem's context.
            expect(scheduleCountFor('kick')).toBe(2);
        });

        it('keeps the key source out of the stem’s audio, so only the keyed track is heard', async () => {
            offlineRenderMocks.sidechainStore.value = {
                routes: [{ sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'comp-1' }],
            };
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(keyedPair()));
            primeStemRender();

            await exportStems(4);

            const bassStrips = stripsForStem('bass');
            const keyStrip = bassStrips?.get('kick') as { outputNode: { connect: ReturnType<typeof vi.fn> } };
            const stemStrip = bassStrips?.get('bass') as { outputNode: { connect: ReturnType<typeof vi.fn> } };
            // The keyed track reaches the destination; its key source never does.
            expect(stemStrip.outputNode.connect).toHaveBeenCalledWith({ id: 'destination' });
            expect(keyStrip.outputNode.connect).not.toHaveBeenCalled();
        });

        it('aligns the stem key with the same delay resolver the mixdown uses', async () => {
            offlineRenderMocks.sidechainStore.value = {
                routes: [{ sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'comp-1' }],
            };
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(keyedPair()));
            primeStemRender();

            await exportStems(4);

            const call = offlineRenderMocks.connectOfflineSidechainRoutes.mock.calls
                .map((entry) => entry[0] as { keyDelaySecFor: unknown })
                .at(0);
            expect(call?.keyDelaySecFor).toBe(offlineRenderMocks.getSidechainKeyDelay);
        });

        it('does the key wiring only for the stem that owns the compressor, not for the source track’s own stem', async () => {
            offlineRenderMocks.sidechainStore.value = {
                routes: [{ sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'comp-1' }],
            };
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(keyedPair()));
            primeStemRender();

            await exportStems(4);

            // Two stems render; only 'bass' hosts a keyed device, so only its
            // context is prepared and wired. 'kick' stays a plain single-track stem.
            expect(offlineRenderMocks.connectOfflineSidechainRoutes).toHaveBeenCalledTimes(1);
            expect(offlineRenderMocks.prepareOfflineSidechainCompressor).toHaveBeenCalledTimes(1);
            expect(scheduleCountFor('bass')).toBe(1);
        });

        it('builds one shared key strip when two compressors on the stem share a source', async () => {
            const tracks = keyedPair();
            tracks[1]!.devices = [
                compressorDevice,
                { id: 'comp-2', type: 'builtin-sidechain-compressor', bypassed: false },
            ];
            offlineRenderMocks.sidechainStore.value = {
                routes: [
                    { sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'comp-1' },
                    { sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'comp-2' },
                ],
            };
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(tracks));
            primeStemRender();

            await exportStems(4);

            const bassStrips = stripsForStem('bass');
            expect(bassStrips?.size).toBe(2);
            // Scheduled twice overall: once as its own stem, once as the shared key.
            expect(scheduleCountFor('kick')).toBe(2);
        });

        it('ignores a route whose target device is bypassed, leaving that stem unducked', async () => {
            const tracks = keyedPair();
            tracks[1]!.devices = [{ ...compressorDevice, bypassed: true }];
            offlineRenderMocks.sidechainStore.value = {
                routes: [{ sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'comp-1' }],
            };
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(tracks));
            primeStemRender();

            await exportStems(4);

            expect(offlineRenderMocks.connectOfflineSidechainRoutes).not.toHaveBeenCalled();
            // 'kick' is still scheduled once, as its own stem — but never a second
            // time as a key, because a bypassed compressor needs none.
            expect(scheduleCountFor('kick')).toBe(1);
        });

        it('does no sidechain work at all for a project with no routes', async () => {
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(keyedPair()));
            primeStemRender();

            await exportStems(4);

            expect(offlineRenderMocks.connectOfflineSidechainRoutes).not.toHaveBeenCalled();
            expect(offlineRenderMocks.prepareOfflineSidechainCompressor).not.toHaveBeenCalled();
        });

        it('drops a route whose key source is missing from the project', async () => {
            offlineRenderMocks.sidechainStore.value = {
                routes: [{ sourceTrackId: 'ghost', targetTrackId: 'bass', targetDeviceId: 'comp-1' }],
            };
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext(keyedPair()));
            primeStemRender();

            await exportStems(4);

            expect(offlineRenderMocks.connectOfflineSidechainRoutes).not.toHaveBeenCalled();
        });
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
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
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
        // Empty tracks → returns early after parsing; the bounded request still
        // resolves from timeline zero so any real stem would receive history.
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
                durationBeats: 10,
                sampleRate: 48_000,
                startBeat: 0,
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
            new Promise((resolve) => {
                resolveRender = resolve;
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

    // The render pool used to hand every task's rejection straight to the
    // enclosing promise's `reject`, so one unrenderable track discarded every
    // stem that had already rendered — including stems from tracks that had
    // nothing to do with the failure. A stem set is per-track by construction;
    // a per-track failure has to stay per-track.
    describe('one failing stem does not discard the rest', () => {
        const stemTrack = (id: string) => ({ id, kind: 'midi', disabled: false, muted: false, devices: [] });

        function primeStemPool(failingTrackId: string): void {
            offlineRenderMocks.createOfflineTrackStrip.mockImplementation((_ctx: unknown, track: { id: string }) => {
                if (track.id === failingTrackId) {
                    return Promise.reject(
                        new Error(`Track "${track.id}" uses the device "crust", which this build cannot render`)
                    );
                }
                return Promise.resolve({
                    inputNode: {},
                    faderNode: {},
                    panNode: {},
                    outputNode: { connect: vi.fn() },
                    deviceEntries: [],
                });
            });
            offlineRenderMocks.renderWithTimeout.mockImplementation(() => Promise.resolve({ id: 'buffer' }));
            vi.stubGlobal(
                'OfflineAudioContext',
                vi.fn(function OfflineContext() {
                    return { destination: {} };
                })
            );
        }

        it('delivers the stems that rendered and names the track that failed', async () => {
            const onWarning = vi.fn();
            offlineRenderMocks.resolveRenderContext.mockReturnValue(
                createRenderContext([stemTrack('keys'), stemTrack('broken'), stemTrack('bass')])
            );
            primeStemPool('broken');

            const stems = await exportStems({ durationBeats: 4, onWarning });

            expect([...stems.keys()].sort()).toEqual(['bass', 'keys']);
            const warnings = onWarning.mock.calls.map((call) => String(call[0])).join('\n');
            expect(warnings).toContain('broken');
            vi.unstubAllGlobals();
        });

        // Delivering an empty set silently would repeat the defect this branch
        // exists to stop: a dialog reporting success over a file that contains
        // nothing the session plays.
        it('fails the export when every stem failed, rather than returning nothing', async () => {
            const onWarning = vi.fn();
            offlineRenderMocks.resolveRenderContext.mockReturnValue(createRenderContext([stemTrack('broken')]));
            primeStemPool('broken');

            await expect(exportStems({ durationBeats: 4, onWarning })).rejects.toMatchObject({ _tag: 'Export' });
            vi.unstubAllGlobals();
        });
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
