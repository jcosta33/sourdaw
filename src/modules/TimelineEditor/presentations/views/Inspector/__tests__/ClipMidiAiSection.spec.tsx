import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { generateMidiVariations } from '#/modules/AiGeneration/useCases';
import { notifyAiChange } from '#/modules/AiRuntime/useCases';
import { modelRegistryStore } from '#/modules/BrowserAi/stores';
import { downloadModel, KOKORO_MODEL_ENTRY, renderDdspInstrument, renderKokoroTts } from '#/modules/BrowserAi/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { ClipMidiAiSection } from '../ClipMidiAiSection';

import type { Clip } from '../../../../models/TrackViewTypes';

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({
        title,
        startSlot,
        compact,
        className,
    }: {
        title: string;
        startSlot?: React.ReactNode;
        compact?: boolean;
        className?: string;
    }) => (
        <div className={className} data-compact={compact}>
            {startSlot}
            <span>{title}</span>
        </div>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        disabled,
        className,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        className?: string;
    }) => (
        <button type="button" onClick={onClick} disabled={disabled} className={className}>
            {children}
        </button>
    ),
}));

vi.mock('#/modules/AiGeneration/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AiGeneration/useCases')>();
    return {
        ...actual,
        generateMidiVariations: vi.fn(),
    };
});

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AiRuntime/useCases')>();
    return {
        ...actual,
        notifyAiChange: vi.fn(),
    };
});

vi.mock('#/modules/BrowserAi/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/BrowserAi/useCases')>();
    return {
        ...actual,
        downloadModel: vi.fn(),
        renderDdspInstrument: vi.fn(),
        renderKokoroTts: vi.fn(),
    };
});

vi.mock('#/modules/BrowserAi/presentations/views', () => ({
    KokoroVoiceSelector: ({
        value,
        onChange,
        disabled,
    }: {
        value: string;
        onChange: (voiceId: string) => void;
        disabled?: boolean;
    }) => (
        <select aria-label="Voice" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
            <option value={value}>{value}</option>
        </select>
    ),
    AiRenderClipPreview: ({
        label,
        name,
    }: {
        audio: Float32Array;
        sampleRate: number;
        label: string;
        name: string;
    }) => <div data-testid="ai-render-preview">{`${label}: ${name}`}</div>,
}));

type TestMidiNote = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };
type TestMidiState = { notesByClipId: Record<string, TestMidiNote[]> };

const midiStoreMock = vi.hoisted(() => ({
    state: null as TestMidiState | null,
}));

vi.mock('#/modules/MIDI/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/stores')>();
    return {
        ...actual,
        midiStore: {
            ...actual.midiStore,
            get value() {
                return midiStoreMock.state;
            },
        },
    };
});

describe('ClipMidiAiSection', () => {
    const mockClip: Clip = {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Test Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
    };

    const defaultProps = {
        clip: mockClip,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByText('AI Actions')).toBeInTheDocument();
    });

    it('should display section title', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByText('AI Variations')).toBeInTheDocument();
    });

    it('should display description text', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByText(/Generate 3 musical variations/)).toBeInTheDocument();
    });

    it('should show generate button', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByRole('button', { name: /Generate/ })).toBeInTheDocument();
    });

    it('should show correct initial button text', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        const button = screen.getByRole('button', { name: /Generate/ });
        expect(button).not.toBeDisabled();
        expect(button.textContent).toContain('Generate');
    });

    it('keeps singing synthesis unavailable without an admitted vocoder', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByRole('button', { name: 'Sung unavailable' })).toBeDisabled();
    });
});

describe('ClipMidiAiSection — in-flight render staleness (audit M-250)', () => {
    const clipA: Clip = {
        id: 'clip-a',
        trackId: 'track-1',
        name: 'Clip A',
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
    const clipB: Clip = { ...clipA, id: 'clip-b', name: 'Clip B' };

    const makeReadySubModel = (id: string) => ({
        id,
        name: id,
        family: 'diffsinger-acoustic' as const,
        sizeBytes: 1000,
        url: `https://example.test/${id}`,
        license: 'Apache-2.0' as const,
        attribution: 'test',
        nativeSampleRate: 44100,
        status: 'ready' as const,
        downloadProgress: 1,
    });

    const setKokoroReadyRegistry = (): void => {
        modelRegistryStore.set({
            ddspInstruments: [],
            kokoroModel: { ...makeReadySubModel('kokoro-82m'), family: 'kokoro' as const, quantization: 'q8' as const },
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 0,
        });
    };

    // A job is held open until the test decides how it ends, so a clip switch or a second
    // launch can be interleaved between the launch and the resolution — the window M-250
    // describes. Gates are keyed by call ordinal rather than by clip, because two launches for
    // the same clip produce identical phrase ids and cannot be told apart any other way.
    type Gate = { promise: Promise<void>; open: () => void; fail: (error: Error) => void };
    const createGate = (): Gate => {
        let open: () => void = () => undefined;
        let fail: (error: Error) => void = () => undefined;
        const promise = new Promise<void>((resolve, reject) => {
            open = resolve;
            fail = reject;
        });
        return { promise, open, fail };
    };

    type CallLog = { calls: number; held: Map<number, Gate> };
    const newCallLog = (): CallLog => ({ calls: 0, held: new Map<number, Gate>() });

    let ttsCalls = newCallLog();
    let variationCalls = newCallLog();
    const variationTokenSinks: Array<(token: string) => void> = [];

    /** Hold the Nth call to a mocked job open until the returned gate is settled. */
    const hold = (log: CallLog, callOrdinal: number): Gate => {
        const gate = createGate();
        log.held.set(callOrdinal, gate);
        return gate;
    };

    const awaitTurn = async (log: CallLog): Promise<void> => {
        log.calls += 1;
        const gate = log.held.get(log.calls);
        if (gate) {
            await gate.promise;
        }
    };

    /** Settle a held job and let every queued continuation run before asserting. */
    const settleJobs = async (settle: () => void): Promise<void> => {
        await act(async () => {
            settle();
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });
    };

    const captureLaunchAbort = () => {
        const abort = AbortController.prototype.abort;
        let abortedSignal: AbortSignal | undefined;
        const spy = vi.spyOn(AbortController.prototype, 'abort').mockImplementation(function captureSignal(
            this: AbortController,
            reason?: unknown
        ): void {
            abortedSignal = this.signal;
            abort.call(this, reason);
        });
        return { spy, signal: () => abortedSignal };
    };

    const makeRenderOutput = () => ({
        audio: new Float32Array([0.25, -0.25]),
        sampleRate: 44100,
        provenance: {
            modelId: 'test-model',
            renderQuality: 'standard' as const,
            renderedAt: 0,
            tier: 'browser-preview' as const,
        },
    });

    const ddspInstrument = {
        id: 'ddsp-violin',
        name: 'Violin',
        family: 'ddsp' as const,
        instrument: 'violin',
        url: 'https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/violin/model.json',
        sizeBytes: 4,
        license: 'Unverified' as const,
        attribution: 'Magenta',
        nativeSampleRate: 16_000,
        frameRate: 250,
        artifactVersion: 'v1',
        artifacts: [],
        status: 'ready' as const,
        downloadProgress: 1,
    };

    const setDdspReadyRegistry = (): void => {
        modelRegistryStore.set({
            ddspInstruments: [ddspInstrument],
            kokoroModel: null,
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 0,
        });
    };

    const setDdspNotes = (...clips: Clip[]): void => {
        midiStoreMock.state = {
            notesByClipId: Object.fromEntries(
                clips.map((clip) => [
                    clip.id,
                    [{ id: `note-${clip.id}`, pitch: 60, velocity: 100, startBeat: 0, duration: 1 }],
                ])
            ),
        };
    };

    const ddspButton = (): HTMLElement => screen.getByRole('button', { name: /Rendering…|Render Instrument/ });

    const installTtsMock = (): void => {
        vi.mocked(renderKokoroTts).mockImplementation(async () => {
            await awaitTurn(ttsCalls);
            return makeRenderOutput();
        });
    };

    const installVariationsMock = (): void => {
        vi.mocked(generateMidiVariations).mockImplementation(
            async (_clipId: string, options?: { onToken?: (token: string) => void }) => {
                if (options?.onToken) {
                    variationTokenSinks.push(options.onToken);
                }
                await awaitTurn(variationCalls);
                return 3;
            }
        );
    };

    /** The one render button in the Vocals card, whichever branch it is currently showing. */
    const renderButton = (): HTMLElement => screen.getByRole('button', { name: /Rendering…|Render 3 Alternatives/ });

    /** The one button in the AI Variations card, whichever branch it is currently showing. */
    const variationsButton = (): HTMLElement => screen.getByRole('button', { name: /Generat|Streaming/ });

    /** Type text into the TTS field and press Render — the user's launch gesture. */
    const launchTtsRender = (text: string): void => {
        fireEvent.change(screen.getByLabelText('TTS text'), { target: { value: text } });
        fireEvent.click(screen.getByRole('button', { name: /Render 3 Alternatives/ }));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        midiStoreMock.state = null;
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
        ttsCalls = newCallLog();
        variationCalls = newCallLog();
        variationTokenSinks.length = 0;
    });

    afterEach(() => {
        // vi.clearAllMocks() clears recorded calls but KEEPS implementations, and there is no
        // clearMocks/mockReset in vite.config.ts nor any global reset in setupTests.ts. Without
        // this, an implementation installed by one test leaks into every later test in the file.
        vi.mocked(renderKokoroTts).mockReset();
        vi.mocked(renderDdspInstrument).mockReset();
        vi.mocked(generateMidiVariations).mockReset();
        modelRegistryStore.set({
            ddspInstruments: [],
            kokoroModel: null,
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 0,
        });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
        vi.restoreAllMocks();
    });

    // ADR 0015 — a launch stops owning the panel two independent ways, and both are driven in
    // both directions here:
    //
    //   identity     — the panel moved to another clip   (`renderedClipIdRef` vs `launchClipId`)
    //   cancellation  — clip-change cleanup aborted it   (`signal.aborted`)
    //
    // An A→B→A round trip is useful because clip identity matches again when the abandoned A job
    // settles; only the signal proves the committed B transition cancelled its panel ownership.
    // Every absence assertion below is pinned by a positive twin, so "never write anything back"
    // would red the pair rather than pass it.

    it('downloads Kokoro through its exact artifact manifest', () => {
        render(<ClipMidiAiSection clip={clipA} />);

        fireEvent.click(screen.getByRole('button', { name: /Download Voice Model/ }));

        expect(vi.mocked(downloadModel)).toHaveBeenCalledWith({
            modelId: KOKORO_MODEL_ENTRY.id,
            family: KOKORO_MODEL_ENTRY.family,
            url: KOKORO_MODEL_ENTRY.url,
            sizeBytes: KOKORO_MODEL_ENTRY.sizeBytes,
            sha256: KOKORO_MODEL_ENTRY.sha256,
        });
    });

    it('uses the transport default tempo when the tempo map is empty', async () => {
        setDdspReadyRegistry();
        const nonzeroTimelineClip = { ...clipA, startBeat: 8, endBeat: 12 };
        transportStore.set({ ...defaultTransportState, tempo: 90 });
        tempoMapStore.set({ changes: [] });
        midiStoreMock.state = {
            notesByClipId: {
                [nonzeroTimelineClip.id]: [{ id: 'n', pitch: 60, velocity: 100, startBeat: 1, duration: 1 }],
            },
        };
        vi.mocked(renderDdspInstrument).mockResolvedValue({
            audio: new Float32Array([0.1, 0.2]),
            sampleRate: 44_100,
            provenance: {
                modelId: ddspInstrument.id,
                renderQuality: 'standard',
                renderedAt: 1,
                tier: 'browser-preview',
            },
        });

        render(<ClipMidiAiSection clip={nonzeroTimelineClip} />);
        fireEvent.click(screen.getByRole('button', { name: /Render Instrument/ }));

        await screen.findByTestId('ai-render-preview');
        const input = vi.mocked(renderDdspInstrument).mock.calls[0]?.[0];
        expect(input).toEqual(
            expect.objectContaining({
                phraseId: `${nonzeroTimelineClip.id}-ddsp`,
                instrumentId: ddspInstrument.id,
                signal: expect.any(AbortSignal),
            })
        );
        expect(input?.durationSec).toBeCloseTo(8 / 3, 9);
        expect(input?.notes[0]?.startSec).toBeCloseTo(2 / 3, 9);
        expect(input?.notes[0]?.durationSec).toBeCloseTo(2 / 3, 9);
    });

    it('integrates a mid-clip tempo step for clip-relative DDSP timing', async () => {
        setDdspReadyRegistry();
        const clip = { ...clipA, startBeat: 8, endBeat: 12 };
        tempoMapStore.set({
            changes: [
                { id: 'base', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'step', beat: 10, tempo: 60, curve: 'instant' },
            ],
        });
        midiStoreMock.state = {
            notesByClipId: {
                [clip.id]: [{ id: 'n', pitch: 60, velocity: 100, startBeat: 1, duration: 2 }],
            },
        };
        vi.mocked(renderDdspInstrument).mockResolvedValue(makeRenderOutput());

        render(<ClipMidiAiSection clip={clip} />);
        fireEvent.click(ddspButton());

        await screen.findByTestId('ai-render-preview');
        const input = vi.mocked(renderDdspInstrument).mock.calls[0]?.[0];
        expect(input?.durationSec).toBeCloseTo(3, 9);
        expect(input?.notes[0]?.startSec).toBeCloseTo(0.5, 9);
        expect(input?.notes[0]?.durationSec).toBeCloseTo(1.5, 9);
    });

    it('integrates a tempo ramp crossed by the clip and its note', async () => {
        setDdspReadyRegistry();
        const clip = { ...clipA, startBeat: 8, endBeat: 12 };
        tempoMapStore.set({
            changes: [
                { id: 'ramp', beat: 8, tempo: 60, curve: 'linear' },
                { id: 'target', beat: 12, tempo: 120, curve: 'instant' },
            ],
        });
        midiStoreMock.state = {
            notesByClipId: {
                [clip.id]: [{ id: 'n', pitch: 60, velocity: 100, startBeat: 1, duration: 2 }],
            },
        };
        vi.mocked(renderDdspInstrument).mockResolvedValue(makeRenderOutput());

        render(<ClipMidiAiSection clip={clip} />);
        fireEvent.click(ddspButton());

        await screen.findByTestId('ai-render-preview');
        const input = vi.mocked(renderDdspInstrument).mock.calls[0]?.[0];
        expect(input?.durationSec).toBeCloseTo(4 * Math.LN2, 9);
        expect(input?.notes[0]?.startSec).toBeCloseTo(4 * Math.log(75 / 60), 9);
        expect(input?.notes[0]?.durationSec).toBeCloseTo(4 * Math.log(105 / 75), 9);
    });

    it('uses a tempo-map event before the clip while keeping note timing clip-relative', async () => {
        setDdspReadyRegistry();
        const clip = { ...clipA, startBeat: 8, endBeat: 12 };
        tempoMapStore.set({ changes: [{ id: 'prior', beat: 4, tempo: 150, curve: 'instant' }] });
        midiStoreMock.state = {
            notesByClipId: {
                [clip.id]: [{ id: 'n', pitch: 60, velocity: 100, startBeat: 1, duration: 1 }],
            },
        };
        vi.mocked(renderDdspInstrument).mockResolvedValue(makeRenderOutput());

        render(<ClipMidiAiSection clip={clip} />);
        fireEvent.click(ddspButton());

        await screen.findByTestId('ai-render-preview');
        const input = vi.mocked(renderDdspInstrument).mock.calls[0]?.[0];
        expect(input?.durationSec).toBeCloseTo(1.6, 9);
        expect(input?.notes[0]?.startSec).toBeCloseTo(0.4, 9);
        expect(input?.notes[0]?.durationSec).toBeCloseTo(0.4, 9);
    });

    it('drops a DDSP completion after switching clips while the current launch still paints and notifies', async () => {
        setDdspReadyRegistry();
        setDdspNotes(clipA, clipB);
        const first = createGate();
        const second = createGate();
        let firstSignal: AbortSignal | undefined;
        let firstAbortCount = 0;
        vi.mocked(renderDdspInstrument)
            .mockImplementationOnce(async ({ signal }) => {
                firstSignal = signal;
                signal?.addEventListener('abort', () => {
                    firstAbortCount += 1;
                });
                await first.promise;
                return makeRenderOutput();
            })
            .mockImplementationOnce(async () => {
                await second.promise;
                return makeRenderOutput();
            });
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(ddspButton());
        rerender(<ClipMidiAiSection clip={clipB} />);
        expect(firstSignal?.aborted).toBe(true);
        expect(firstAbortCount).toBe(1);
        fireEvent.click(ddspButton());
        await settleJobs(() => first.open());
        expect(screen.queryAllByTestId('ai-render-preview')).toHaveLength(0);
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        await settleJobs(() => second.open());
        expect(screen.getByTestId('ai-render-preview')).toHaveTextContent('DDSP: Violin');
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Instrument render complete', expect.any(Array));
        expect(firstAbortCount).toBe(1);
    });

    it('aborts the owned DDSP render on unmount and ignores its late completion', async () => {
        setDdspReadyRegistry();
        setDdspNotes(clipA);
        const pending = createGate();
        let signal: AbortSignal | undefined;
        let abortCount = 0;
        vi.mocked(renderDdspInstrument).mockImplementationOnce(async (input) => {
            signal = input.signal;
            signal?.addEventListener('abort', () => {
                abortCount += 1;
            });
            await pending.promise;
            return makeRenderOutput();
        });

        const { unmount } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(ddspButton());
        unmount();

        expect(signal?.aborted).toBe(true);
        expect(abortCount).toBe(1);
        await settleJobs(() => pending.open());
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(abortCount).toBe(1);
    });

    it('keeps an A→B→A-abandoned DDSP completion out of the fresh A panel', async () => {
        setDdspReadyRegistry();
        setDdspNotes(clipA, clipB);
        const first = createGate();
        const second = createGate();
        vi.mocked(renderDdspInstrument)
            .mockImplementationOnce(async () => {
                await first.promise;
                return makeRenderOutput();
            })
            .mockImplementationOnce(async () => {
                await second.promise;
                return makeRenderOutput();
            });
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(ddspButton());
        rerender(<ClipMidiAiSection clip={clipB} />);
        rerender(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(ddspButton());
        await settleJobs(() => first.open());
        expect(screen.queryAllByTestId('ai-render-preview')).toHaveLength(0);
        await settleJobs(() => second.open());
        expect(screen.getByTestId('ai-render-preview')).toHaveTextContent('DDSP: Violin');
    });

    it('does not report a DDSP failure or clear the newer spinner after switching clips', async () => {
        setDdspReadyRegistry();
        setDdspNotes(clipA, clipB);
        const abandoned = createGate();
        const current = createGate();
        vi.mocked(renderDdspInstrument)
            .mockImplementationOnce(async () => {
                await abandoned.promise;
                return makeRenderOutput();
            })
            .mockImplementationOnce(async () => {
                await current.promise;
                return makeRenderOutput();
            });
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(ddspButton());
        rerender(<ClipMidiAiSection clip={clipB} />);
        fireEvent.click(ddspButton());

        await settleJobs(() => abandoned.fail(new Error('abandoned DDSP failure')));

        // Removing the ownership guard in either catch or finally makes this error toast appear
        // or returns clip B's still-pending launch to an enabled button.
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
        expect(ddspButton()).toHaveTextContent('Rendering…');

        await settleJobs(() => current.open());
        expect(screen.getByTestId('ai-render-preview')).toHaveTextContent('DDSP: Violin');
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Instrument render complete', expect.any(Array));
    });

    it('suppresses an A→B→A-abandoned DDSP failure while reporting the fresh A failure', async () => {
        setDdspReadyRegistry();
        setDdspNotes(clipA, clipB);
        const abandoned = createGate();
        const current = createGate();
        vi.mocked(renderDdspInstrument)
            .mockImplementationOnce(async () => {
                await abandoned.promise;
                return makeRenderOutput();
            })
            .mockImplementationOnce(async () => {
                await current.promise;
                return makeRenderOutput();
            });
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(ddspButton());
        rerender(<ClipMidiAiSection clip={clipB} />);
        rerender(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(ddspButton());

        await settleJobs(() => abandoned.fail(new Error('abandoned DDSP failure')));
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
        expect(ddspButton()).toHaveTextContent('Rendering…');

        await settleJobs(() => current.fail(new Error('current DDSP failure')));
        expect(vi.mocked(notifyUser)).toHaveBeenCalledWith('current DDSP failure', 'error');
        expect(ddspButton()).toHaveTextContent('Render Instrument');
    });

    it('discards a TTS render that resolves after a clip switch (audit M-250)', async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const abandoned = hold(ttsCalls, 1);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('hello world');
        expect(vi.mocked(renderKokoroTts)).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ phraseId: 'clip-a-tts-A' })
        );

        rerender(<ClipMidiAiSection clip={clipB} />);
        await settleJobs(() => abandoned.open());

        // Mutation that reds this test: delete the `if (!stillOwnsPanel(…)) return;` after the
        // await in handlePreviewVoice — clip A's vocals then paint onto clip B's panel.
        expect(screen.queryAllByTestId('ai-render-preview')).toHaveLength(0);
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        // The abandoned launch must also stop queueing its remaining variants.
        expect(vi.mocked(renderKokoroTts)).toHaveBeenCalledTimes(1);
    });

    it('applies a TTS render to the panel when the clip did not change (presence pin)', async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const gate = hold(ttsCalls, 1);
        render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('hello world');
        await settleJobs(() => gate.open());

        // Mutation that reds this test: make the ownership check unconditional (`return;` after
        // the await) — the guard can fail in the "keep" direction too.
        expect(screen.getAllByTestId('ai-render-preview').map((row) => row.textContent)).toEqual([
            'A: af_heart · hello world',
            'B: af_heart · hello world',
            'C: af_heart · hello world',
        ]);
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Vocal preview ready', [
            '3 alternatives rendered — drag one onto an audio track',
        ]);
        expect(vi.mocked(renderKokoroTts)).toHaveBeenCalledTimes(3);
    });

    it('aborts the owned TTS render on unmount and ignores its late completion', async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const pending = hold(ttsCalls, 1);
        const abort = captureLaunchAbort();
        const { unmount } = render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('hello world');

        unmount();

        expect(abort.spy).toHaveBeenCalledTimes(1);
        expect(abort.signal()?.aborted).toBe(true);
        await settleJobs(() => pending.open());
        expect(vi.mocked(renderKokoroTts)).toHaveBeenCalledTimes(1);
        expect(screen.queryAllByTestId('ai-render-preview')).toHaveLength(0);
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    });

    it('aborts the owned TTS render on unmount and ignores its late failure', async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const pending = hold(ttsCalls, 1);
        const abort = captureLaunchAbort();
        const { unmount } = render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('hello world');

        unmount();

        expect(abort.spy).toHaveBeenCalledTimes(1);
        expect(abort.signal()?.aborted).toBe(true);
        await settleJobs(() => pending.fail(new Error('late TTS failure')));
        expect(screen.queryAllByTestId('ai-render-preview')).toHaveLength(0);
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    });

    it('does not report a TTS failure that arrives after a clip switch (audit M-250)', async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const abandoned = hold(ttsCalls, 1);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('hello world');

        rerender(<ClipMidiAiSection clip={clipB} />);
        await settleJobs(() => abandoned.fail(new Error('ONNX session crashed')));

        // Mutation that reds this test: delete the ownership check from the catch in
        // handlePreviewVoice — clip B gets an error toast about clip A's render.
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    });

    it('reports a TTS failure that arrives while the clip is still selected (presence pin)', async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const gate = hold(ttsCalls, 1);
        render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('hello world');

        await settleJobs(() => gate.fail(new Error('ONNX session crashed')));

        // Mutation that reds this test: make the catch check unconditional (`return;` before
        // notifyUser) — genuine failures on the current clip would then be swallowed.
        expect(vi.mocked(notifyUser)).toHaveBeenCalledWith('ONNX session crashed', 'error');
    });

    it("keeps the new clip's TTS spinner running when the abandoned render settles (audit M-250)", async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const abandoned = hold(ttsCalls, 1);
        hold(ttsCalls, 2);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('hello world');

        rerender(<ClipMidiAiSection clip={clipB} />);
        launchTtsRender('second take');
        expect(vi.mocked(renderKokoroTts)).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ phraseId: 'clip-b-tts-A' })
        );

        await settleJobs(() => abandoned.open());

        // Mutation that reds this test: drop the ownership check around setIsRenderingTts(false)
        // in the finally — clip A's launch then returns clip B's button to "Render 3
        // Alternatives" while clip B is still rendering.
        expect(renderButton().textContent).toContain('Rendering…');
    });

    // The clip-change reset clears isRenderingTts, so an A→B→A round trip re-enables the render
    // button while the first job is still in flight. `launchClipId` matches again after returning
    // to A, so this specifically proves the committed clip-change cleanup aborted the old launch.

    it('keeps an A→B→A-abandoned TTS launch out of the fresh A panel (audit M-250)', async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const abandoned = hold(ttsCalls, 1);
        hold(ttsCalls, 2);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('first take');

        rerender(<ClipMidiAiSection clip={clipB} />);
        rerender(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('second take');
        expect(vi.mocked(renderKokoroTts)).toHaveBeenCalledTimes(2);

        await settleJobs(() => abandoned.open());

        // Mutation that reds this test: omit TTS from the clip-change cleanup, or drop the
        // `signal.aborted` branch from stillOwnsPanel — the abandoned launch then paints its
        // previews and stops the fresh launch's spinner.
        expect(screen.queryAllByTestId('ai-render-preview')).toHaveLength(0);
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(renderButton().textContent).toContain('Rendering…');
    });

    // MIDI variations. Same defect, same panel, and the most reachable of the three: the button
    // is gated only on isGeneratingVariations, so no typing or mode switch is needed to relaunch.

    it('does not announce variations that finish after a clip switch (audit M-250)', async () => {
        installVariationsMock();
        const abandoned = hold(variationCalls, 1);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());
        expect(vi.mocked(generateMidiVariations)).toHaveBeenCalledWith('clip-a', expect.anything());

        rerender(<ClipMidiAiSection clip={clipB} />);
        await settleJobs(() => abandoned.open());

        // Mutation that reds this test: delete the ownership check before notifyAiChange in
        // handleGenerateVariations — clip A's variations are announced on clip B's panel.
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
    });

    it('announces variations that finish while the clip is still selected (presence pin)', async () => {
        installVariationsMock();
        const gate = hold(variationCalls, 1);
        render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        await settleJobs(() => gate.open());

        // Mutation that reds this test: make that ownership check unconditional (`return;`
        // before notifyAiChange) — successful generations would announce nothing.
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('MIDI variations generated', [
            '3 variations created as alternative clips',
        ]);
    });

    it('aborts the owned variation generation on unmount and ignores its late completion', async () => {
        installVariationsMock();
        const pending = hold(variationCalls, 1);
        const abort = captureLaunchAbort();
        const { unmount } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        unmount();

        expect(abort.spy).toHaveBeenCalledTimes(1);
        expect(abort.signal()?.aborted).toBe(true);
        await settleJobs(() => pending.open());
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    });

    it('aborts the owned variation generation on unmount and ignores its late failure', async () => {
        installVariationsMock();
        const pending = hold(variationCalls, 1);
        const abort = captureLaunchAbort();
        const { unmount } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        unmount();

        expect(abort.spy).toHaveBeenCalledTimes(1);
        expect(abort.signal()?.aborted).toBe(true);
        await settleJobs(() => pending.fail(new Error('late variation failure')));
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    });

    it("keeps an abandoned generation out of the new clip's streaming readout (audit M-250)", async () => {
        installVariationsMock();
        hold(variationCalls, 1);
        hold(variationCalls, 2);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        rerender(<ClipMidiAiSection clip={clipB} />);
        fireEvent.click(variationsButton());

        const abandonedOnToken = variationTokenSinks[0];
        const currentOnToken = variationTokenSinks[1];
        act(() => currentOnToken!('12345'));
        act(() => abandonedOnToken!('XXXXXXXXXX'));

        // Mutation that reds this test: delete the ownership check inside the onToken callback —
        // clip A's ten streamed characters inflate clip B's readout to "Streaming… 15 chars".
        expect(variationsButton().textContent).toContain('Streaming… 5 chars');
    });

    it('does not report a variation failure that arrives after a clip switch (audit M-250)', async () => {
        installVariationsMock();
        const abandoned = hold(variationCalls, 1);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        rerender(<ClipMidiAiSection clip={clipB} />);
        await settleJobs(() => abandoned.fail(new Error('provider refused the request')));

        // Mutation that reds this test: delete the ownership check from the catch in
        // handleGenerateVariations — clip B gets an error toast about clip A's generation.
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    });

    it('reports a variation failure that arrives while the clip is still selected (presence pin)', async () => {
        installVariationsMock();
        const gate = hold(variationCalls, 1);
        render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        await settleJobs(() => gate.fail(new Error('provider refused the request')));

        // Mutation that reds this test: make that catch check unconditional (`return;` before
        // notifyUser) — genuine failures on the current clip would then be swallowed.
        expect(vi.mocked(notifyUser)).toHaveBeenCalledWith('provider refused the request', 'error');
    });

    it("keeps the new clip's variation spinner running when the abandoned generation settles (audit M-250)", async () => {
        installVariationsMock();
        const abandoned = hold(variationCalls, 1);
        hold(variationCalls, 2);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        rerender(<ClipMidiAiSection clip={clipB} />);
        fireEvent.click(variationsButton());

        await settleJobs(() => abandoned.open());

        // Mutation that reds this test: drop the ownership check around
        // setIsGeneratingVariations(false) in the finally — clip A's launch then returns clip
        // B's button to "Generate" while clip B is still generating.
        expect(variationsButton().textContent).toContain('Generating…');
    });

    it('keeps an A→B→A-abandoned variation launch out of the fresh A panel (audit M-250)', async () => {
        installVariationsMock();
        const abandoned = hold(variationCalls, 1);
        hold(variationCalls, 2);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        rerender(<ClipMidiAiSection clip={clipB} />);
        rerender(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());
        expect(vi.mocked(generateMidiVariations)).toHaveBeenCalledTimes(2);

        await settleJobs(() => abandoned.open());

        // Mutation that reds this test: omit variations from the clip-change cleanup, or drop
        // the `signal.aborted` branch from stillOwnsPanel — the abandoned launch then announces
        // and stops the fresh launch's spinner.
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(variationsButton().textContent).toContain('Generating…');
    });
});
