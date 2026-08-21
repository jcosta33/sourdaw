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
            resolveTempoAtBeat: ({ defaultTempo: tempo }: { defaultTempo: number }) => tempo,
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

    it('resolves a bounded mixdown from timeline zero before rendering', async () => {
        offlineRenderMocks.resolveRenderContext.mockReturnValue({
            tracks: null,
            midi: null,
            transport: null,
            defaultTempo: 120,
            changes: [],
            durationSeconds: 5,
            projectMidiEvents: vi.fn(),
            selectMidiEventProbability: vi.fn(() => true),
            projectChordPitch: ({ pitch }: { pitch: number }) => pitch,
            projectPpqEndpoints: vi.fn(() => ({ durationSeconds: 0 })),
            resolveTempoAtBeat: ({ defaultTempo: tempo }: { defaultTempo: number }) => tempo,
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

        const result = await renderOffline({ durationBeats: 8, startBeat: 2, sampleRate: 48_000 });

        expect(result).toBe(rendered);
        expect(offlineRenderMocks.resolveRenderContext).toHaveBeenCalledWith({
            durationBeats: 10,
            startBeat: 0,
            tailSeconds: 0,
            sampleRate: 48_000,
        });
    });
});

describe('renderOffline effective audibility (OE-4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Each case starts from the default solo mode (SIP); PFL cases opt in.
        workspaceStore.set(defaultWorkspaceState);
    });

    type SendFixture = { busId: string; level: number; preFader: boolean };

    const audioTrack = (over: {
        id: string;
        kind?: string;
        soloed?: boolean;
        muted?: boolean;
        sends?: SendFixture[];
    }) => ({
        id: over.id,
        kind: over.kind ?? 'audio',
        disabled: false,
        muted: over.muted ?? false,
        soloed: over.soloed ?? false,
        soloSafe: false,
        outputId: 'hw_out',
        devices: [],
        sends: over.sends ?? ([] as SendFixture[]),
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
        resolveTempoAtBeat: ({ defaultTempo: tempo }: { defaultTempo: number }) => tempo,
        processYeastMidi: vi.fn(),
    });

    function primeRender(): void {
        offlineRenderMocks.createOfflineTrackStrip.mockImplementation(
            (_ctx: OfflineAudioContext, track: { id: string }) =>
                Promise.resolve({
                    trackId: track.id,
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

    // FX-8 — the mixdown expressed "muted" twice: `postFaderGain = 0` on the strip
    // AND exclusion from the scheduling set. The first is the live topology (mute
    // sits downstream of `preFaderTap`, so a pre-fader send survives it); the
    // second silences the strip entirely, killing the pre-fader send the live
    // engine keeps feeding. Export therefore lost cue-send content the engineer
    // was monitoring. Scheduling is now driven by "the track can still feed
    // something", with the strip's own mute node still bearing the mute.
    describe('pre-fader sends under mute and solo (FX-8)', () => {
        const busTrack = (id: string) => audioTrack({ id, kind: 'bus' });

        const withSend = (track: ReturnType<typeof audioTrack>, send: { busId: string; preFader: boolean }) => ({
            ...track,
            sends: [{ busId: send.busId, level: 0.7, preFader: send.preFader }],
        });

        it('still schedules an individually muted track that carries a pre-fader send, so its bus keeps receiving it', async () => {
            offlineRenderMocks.resolveRenderContext.mockReturnValue(
                renderContext([
                    busTrack('reverb-bus'),
                    withSend(audioTrack({ id: 'cue', muted: true }), { busId: 'reverb-bus', preFader: true }),
                ])
            );
            primeRender();

            await renderOffline(4);

            expect(scheduledTrackIds()).toContain('cue');
        });

        it('does not schedule a muted track whose only send is post-fader, because the mute node already kills it', async () => {
            offlineRenderMocks.resolveRenderContext.mockReturnValue(
                renderContext([
                    busTrack('reverb-bus'),
                    withSend(audioTrack({ id: 'fx', muted: true }), { busId: 'reverb-bus', preFader: false }),
                ])
            );
            primeRender();

            await renderOffline(4);

            expect(scheduledTrackIds()).not.toContain('fx');
        });

        it('does not schedule a muted track whose pre-fader send targets a bus that no longer exists', async () => {
            offlineRenderMocks.resolveRenderContext.mockReturnValue(
                renderContext([
                    withSend(audioTrack({ id: 'orphan', muted: true }), { busId: 'deleted-bus', preFader: true }),
                ])
            );
            primeRender();

            await renderOffline(4);

            expect(scheduledTrackIds()).not.toContain('orphan');
        });

        it('drops a solo-gated track even when it carries a pre-fader send, so solo does not leak into return buses', async () => {
            offlineRenderMocks.resolveRenderContext.mockReturnValue(
                renderContext([
                    busTrack('reverb-bus'),
                    audioTrack({ id: 'lead', soloed: true }),
                    withSend(audioTrack({ id: 'strings' }), { busId: 'reverb-bus', preFader: true }),
                ])
            );
            primeRender();

            await renderOffline(4);

            expect(scheduledTrackIds()).not.toContain('strings');
            expect(scheduledTrackIds()).toContain('lead');
        });

        // The mixdown builds a strip for every non-disabled track so the routing
        // graph matches live, but schedules only the audible ones and the
        // cue-send feeders. An unrenderable device on a strip that is never
        // scheduled cannot make the file differ from the session, so it must not
        // be able to fail the export — mute has to be an escape from the refusal
        // as well as from the mix.
        describe('device-failure scope follows the scheduling set', () => {
            const stripCallFor = (trackId: string): Record<string, unknown> | undefined => {
                const call = offlineRenderMocks.createOfflineTrackStrip.mock.calls.find(
                    (candidate) => candidate[1].id === trackId
                );
                return call?.[2];
            };

            it('marks a muted, non-contributing track as producing no audio for the render', async () => {
                offlineRenderMocks.resolveRenderContext.mockReturnValue(
                    renderContext([
                        busTrack('reverb-bus'),
                        withSend(audioTrack({ id: 'fx', muted: true }), { busId: 'reverb-bus', preFader: false }),
                    ])
                );
                primeRender();

                await renderOffline(4);

                expect(scheduledTrackIds()).not.toContain('fx');
                expect(stripCallFor('fx')).toMatchObject({ contributesAudio: false });
            });

            it('keeps a muted cue-send feeder contributing, because its bus still receives it', async () => {
                offlineRenderMocks.resolveRenderContext.mockReturnValue(
                    renderContext([
                        busTrack('reverb-bus'),
                        withSend(audioTrack({ id: 'cue', muted: true }), { busId: 'reverb-bus', preFader: true }),
                    ])
                );
                primeRender();

                await renderOffline(4);

                expect(stripCallFor('cue')).toMatchObject({ contributesAudio: true });
            });

            it('keeps an audible track contributing', async () => {
                offlineRenderMocks.resolveRenderContext.mockReturnValue(renderContext([audioTrack({ id: 'lead' })]));
                primeRender();

                await renderOffline(4);

                expect(stripCallFor('lead')).toMatchObject({ contributesAudio: true });
            });

            // Every production caller omitted the warning channel, so a degraded
            // device reached `logger.warn` and nothing else — the export UI never
            // heard about it.
            it('hands every strip the export warning channel', async () => {
                const onWarning = vi.fn();
                offlineRenderMocks.resolveRenderContext.mockReturnValue(renderContext([audioTrack({ id: 'lead' })]));
                primeRender();

                await renderOffline({ durationBeats: 4, onWarning });

                expect(stripCallFor('lead')).toMatchObject({ onWarning });
            });
        });

        it('drops a track that is both muted and solo-gated despite its pre-fader send', async () => {
            offlineRenderMocks.resolveRenderContext.mockReturnValue(
                renderContext([
                    busTrack('reverb-bus'),
                    audioTrack({ id: 'lead', soloed: true }),
                    withSend(audioTrack({ id: 'strings', muted: true }), { busId: 'reverb-bus', preFader: true }),
                ])
            );
            primeRender();

            await renderOffline(4);

            expect(scheduledTrackIds()).not.toContain('strings');
        });
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
        resolveTempoAtBeat: ({ defaultTempo }: { defaultTempo: number }) => defaultTempo,
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

    // The tempo resolver belongs in that same guard, and is the one dependency
    // whose absence would not announce itself: the others make the render fail,
    // while a missing resolver would quietly convert every clip's source offset
    // at the project default and hand back a bounce that sounds plausible and
    // seeks to the wrong place in every project carrying a tempo map.
    it('throws when the clip tempo resolver is not configured', async () => {
        offlineRenderMocks.resolveRenderContext.mockReturnValue({
            tracks: { tracks: [] },
            midi: {},
            transport: null,
            defaultTempo: 120,
            changes: [],
            durationSeconds: 1,
            ...fullProjections(),
            resolveTempoAtBeat: undefined,
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

        offlineRenderMocks.createOfflineTrackStrip.mockImplementation(
            (_ctx: OfflineAudioContext, track: { id: string }) =>
                Promise.resolve({
                    trackId: track.id,
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
        offlineRenderMocks.createOfflineTrackStrip.mockImplementation(
            (_ctx: OfflineAudioContext, track: { id: string }) =>
                Promise.resolve({
                    trackId: track.id,
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
