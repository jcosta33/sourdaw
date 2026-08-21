import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { generateMidiVariations } from '#/modules/AiGeneration/useCases';
import { notifyAiChange } from '#/modules/AiRuntime/useCases';
import { modelRegistryStore } from '#/modules/BrowserAi/stores';
import { downloadModel, KOKORO_MODEL_ENTRY, renderKokoroTts } from '#/modules/BrowserAi/useCases';
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
        variant,
        size,
        asChild: _asChild,
        ...props
    }: React.ComponentProps<'button'> & { variant?: string; size?: string; asChild?: boolean }) => (
        <button type="button" data-variant={variant} data-size={size} {...props}>
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
        ttsCalls = newCallLog();
        variationCalls = newCallLog();
        variationTokenSinks.length = 0;
    });

    afterEach(() => {
        // vi.clearAllMocks() clears recorded calls but KEEPS implementations, and there is no
        // clearMocks/mockReset in vite.config.ts nor any global reset in setupTests.ts. Without
        // this, an implementation installed by one test leaks into every later test in the file.
        vi.mocked(renderKokoroTts).mockReset();
        vi.mocked(generateMidiVariations).mockReset();
        modelRegistryStore.set({
            ddspInstruments: [],
            kokoroModel: null,
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 0,
        });
    });

    // ADR 0015 — a launch stops owning the panel two independent ways, and both are driven in
    // both directions here:
    //
    //   identity     — the panel moved to another clip   (`renderedClipIdRef` vs `launchClipId`)
    //   supersession — a newer launch replaced this one  (`signal.aborted`)
    //
    // Supersession is reachable because the clip-change reset clears the in-flight flags, so an
    // A→B→A round trip re-enables a button whose first job is still running. Every absence
    // assertion below is pinned by a positive twin, so "never write anything back" would red the
    // pair rather than pass it.

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

    // Same-clip supersession. The clip-change reset clears isRenderingTts, so an
    // A→B→A round trip re-enables the render button while the first job is still in flight —
    // `launchClipId` is identical for both launches and cannot separate them.

    it('discards a TTS launch superseded by a newer launch on the same clip (audit M-250)', async () => {
        setKokoroReadyRegistry();
        installTtsMock();
        const superseded = hold(ttsCalls, 1);
        hold(ttsCalls, 2);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('first take');

        rerender(<ClipMidiAiSection clip={clipB} />);
        rerender(<ClipMidiAiSection clip={clipA} />);
        launchTtsRender('second take');
        expect(vi.mocked(renderKokoroTts)).toHaveBeenCalledTimes(2);

        await settleJobs(() => superseded.open());

        // Mutation that reds this test: drop `ttsLaunchRef.current?.abort()` from the launch in
        // handlePreviewVoice, or drop the `signal.aborted` branch from stillOwnsPanel — the
        // first launch then paints its previews and stops the second launch's spinner.
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

    it('discards a variation launch superseded by a newer launch on the same clip (audit M-250)', async () => {
        installVariationsMock();
        const superseded = hold(variationCalls, 1);
        hold(variationCalls, 2);
        const { rerender } = render(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());

        rerender(<ClipMidiAiSection clip={clipB} />);
        rerender(<ClipMidiAiSection clip={clipA} />);
        fireEvent.click(variationsButton());
        expect(vi.mocked(generateMidiVariations)).toHaveBeenCalledTimes(2);

        await settleJobs(() => superseded.open());

        // Mutation that reds this test: drop `variationsLaunchRef.current?.abort()` from the
        // launch in handleGenerateVariations, or drop the `signal.aborted` branch from
        // stillOwnsPanel — the first launch then announces and stops the second's spinner.
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
        expect(variationsButton().textContent).toContain('Generating…');
    });
});
