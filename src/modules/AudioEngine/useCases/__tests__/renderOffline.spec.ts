import { describe, it, expect, beforeEach, vi } from 'vitest';

import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';

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
    prepareOfflineSidechainCompressor: vi.fn(),
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

vi.mock('../../repositories/devices/dynamics/prepareOfflineSidechainCompressor', () => ({
    prepareOfflineSidechainCompressor: offlineRenderMocks.prepareOfflineSidechainCompressor,
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
        // Each case starts from the default solo mode (SIP); PFL cases opt in.
        workspaceStore.set(defaultWorkspaceState);
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

    it('keeps a muted, soloed track audible in the mixdown under PFL (WYSIWYG export ruling)', async () => {
        workspaceStore.set({ ...defaultWorkspaceState, soloMode: 'pfl' });
        offlineRenderMocks.resolveRenderContext.mockReturnValue(
            renderContext([audioTrack({ id: 'solo', soloed: true, muted: true }), audioTrack({ id: 'other' })])
        );
        primeRender();

        await renderOffline(4);

        // Live PFL plays the soloed track on the main bus even though it is muted;
        // WYSIWYG export follows that model through the shared derivation, so the
        // muted+soloed track is rendered and the non-soloed track is dropped.
        expect(scheduledTrackIds()).toEqual(['solo']);
    });

    it('ignores solo owned by a duplicated track id, matching the live ambiguous-owner guard', async () => {
        offlineRenderMocks.resolveRenderContext.mockReturnValue(
            renderContext([
                audioTrack({ id: 'dup', soloed: true }),
                audioTrack({ id: 'dup' }),
                audioTrack({ id: 'unique' }),
            ])
        );
        primeRender();

        await renderOffline(4);

        // 'dup' appears twice, so it is not an unambiguous solo owner: no solo
        // engages and 'unique' stays audible — exactly as the live path behaves.
        expect(scheduledTrackIds()).toContain('unique');
    });
});

describe('renderOffline residual branches', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set(defaultWorkspaceState);
    });

    function stubOfflineCtx() {
        class TestOfflineAudioContext {
            readonly destination = {};
            createGain() {
                return { gain: { value: 0 }, connect: vi.fn() };
            }
        }
        vi.stubGlobal('OfflineAudioContext', TestOfflineAudioContext);
    }

    const fullProjections = () => ({
        projectMidiEvents: vi.fn(),
        selectMidiEventProbability: vi.fn(() => true),
        projectChordPitch: ({ pitch }: { pitch: number }) => pitch,
        projectPpqEndpoints: vi.fn(),
        processYeastMidi: vi.fn(),
        evaluateAutomationValue: vi.fn(),
    });

    // L84: one of the projections is null → throws "not configured".
    it('throws when a musical projection is not configured', async () => {
        offlineRenderMocks.resolveRenderContext.mockReturnValue({
            tracks: { tracks: [] },
            midi: {},
            transport: null,
            defaultTempo: 120,
            changes: [],
            durationSeconds: 1,
            // projectPpqEndpoints missing → the null-guard throws.
            ...fullProjections(),
            projectPpqEndpoints: undefined,
        });
        stubOfflineCtx();
        await expect(renderOffline(4)).rejects.toThrow('Offline musical projection is not configured');
    });

    // L100: tracks or midi is null → allRenderableTracks is []. The `&&` false arm.
    it('produces an empty strip list when tracks is null', async () => {
        offlineRenderMocks.resolveRenderContext.mockReturnValue({
            tracks: null,
            midi: null,
            transport: null,
            defaultTempo: 120,
            changes: [],
            durationSeconds: 1,
            ...fullProjections(),
        });
        offlineRenderMocks.renderWithTimeout.mockResolvedValue({ sampleRate: 44_100 });
        stubOfflineCtx();
        const result = await renderOffline(4);
        expect(result).toEqual({ sampleRate: 44_100 });
        expect(offlineRenderMocks.createOfflineTrackStrip).not.toHaveBeenCalled();
    });

    // L141: prepareOfflineSidechainCompressor throws a non-Error → String() branch.
    it('warns with the stringified reason when sidechain prep throws a non-Error', async () => {
        const onWarning = vi.fn();
        offlineRenderMocks.resolveRenderContext.mockReturnValue({
            tracks: {
                tracks: [
                    {
                        id: 'src',
                        kind: 'audio',
                        disabled: false,
                        muted: false,
                        soloed: false,
                        soloSafe: false,
                        outputId: 'hw_out',
                        devices: [],
                        sends: [],
                    },
                    {
                        id: 'tgt',
                        kind: 'audio',
                        disabled: false,
                        muted: false,
                        soloed: false,
                        soloSafe: false,
                        outputId: 'hw_out',
                        devices: [{ id: 'sc-dev', type: 'builtin-sidechain-compressor', bypassed: false }],
                        sends: [],
                    },
                ],
            },
            midi: {},
            transport: null,
            defaultTempo: 120,
            changes: [],
            durationSeconds: 1,
            ...fullProjections(),
        });
        // Sidechain route from src → tgt/sc-dev so prepareOfflineSidechainCompressor runs.
        const { sidechainStore } = await import('#/modules/Routing/stores');
        sidechainStore.set({
            routes: [{ sourceTrackId: 'src', targetTrackId: 'tgt', targetDeviceId: 'sc-dev', level: 1 }],
        } as never);
        // Force prepareOfflineSidechainCompressor to throw a non-Error value.
        offlineRenderMocks.prepareOfflineSidechainCompressor.mockRejectedValueOnce('wasm compile failed');

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
        stubOfflineCtx();

        // The render must not abort: the catch warns and continues with fallback.
        const result = await renderOffline({ durationBeats: 4, onWarning });
        expect(result).toEqual({ sampleRate: 44_100 });
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Sidechain processor unavailable'));
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('wasm compile failed'));
    });

    // L129: a sidechain route whose source track or target device does not
    // resolve is skipped (the else arm).
    it('skips sidechain routes with no matching source or target device', async () => {
        const { sidechainStore } = await import('#/modules/Routing/stores');
        sidechainStore.set({
            routes: [
                // Source track does not exist in allRenderableTracks.
                { sourceTrackId: 'ghost', targetTrackId: 'tgt', targetDeviceId: 'sc-dev', level: 1 },
                // Target device is bypassed → filtered out.
                {
                    sourceTrackId: 'src',
                    targetTrackId: 'tgt',
                    targetDeviceId: 'bypassed-dev',
                    level: 1,
                },
                // Target device type is not a sidechain compressor.
                {
                    sourceTrackId: 'src',
                    targetTrackId: 'tgt',
                    targetDeviceId: 'eq-dev',
                    level: 1,
                },
            ],
        } as never);
        offlineRenderMocks.resolveRenderContext.mockReturnValue({
            tracks: {
                tracks: [
                    {
                        id: 'src',
                        kind: 'audio',
                        disabled: false,
                        muted: false,
                        soloed: false,
                        soloSafe: false,
                        outputId: 'hw_out',
                        devices: [],
                        sends: [],
                    },
                    {
                        id: 'tgt',
                        kind: 'audio',
                        disabled: false,
                        muted: false,
                        soloed: false,
                        soloSafe: false,
                        outputId: 'hw_out',
                        devices: [
                            { id: 'bypassed-dev', type: 'builtin-sidechain-compressor', bypassed: true },
                            { id: 'eq-dev', type: 'builtin-eq', bypassed: false },
                        ],
                        sends: [],
                    },
                ],
            },
            midi: {},
            transport: null,
            defaultTempo: 120,
            changes: [],
            durationSeconds: 1,
            ...fullProjections(),
        });
        offlineRenderMocks.prepareOfflineSidechainCompressor.mockResolvedValue(undefined);
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
        stubOfflineCtx();

        // No routable sidechain targets → prepareOfflineSidechainCompressor must
        // NOT be called (all routes were filtered by the guard).
        const result = await renderOffline(4);
        expect(result).toEqual({ sampleRate: 44_100 });
        expect(offlineRenderMocks.prepareOfflineSidechainCompressor).not.toHaveBeenCalled();
    });
});
