import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { handleAiDenoiseClip } from '#/modules/AiGeneration/useCases';
import { getWarpState, trackStore, type Clip } from '#/modules/Arrangement/stores';
import {
    addManualWarpMarker,
    commitWarpMarkerBeatDrag,
    disableWarp,
    enableWarp,
    moveWarpMarker,
    normalizeClip,
    normalizeTrack,
    removeWarpMarker,
    replaceClipAudioBuffer,
    reverseClip,
    setStretchMode,
} from '#/modules/Arrangement/useCases';
import { audioToMidi } from '#/modules/AudioAnalysis/useCases';
import {
    decodeAudioFile,
    getCachedAudioBuffer,
    getCachedAudioBufferWaveformPeaks,
} from '#/modules/AudioEngine/useCases';
import { verifyAudioBufferReferences } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { WaveformEditor } from '../WaveformEditor';

const original_canvas_get_context_descriptor = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'getContext'
);
const original_client_width_descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const original_client_height_descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

function restore_property_descriptor(
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor | undefined
): void {
    if (descriptor) {
        Object.defineProperty(target, propertyKey, descriptor);
        return;
    }
    Reflect.deleteProperty(target, propertyKey);
}

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

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        min,
        max,
        step,
        className,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (v: number[]) => void;
        min?: number;
        max?: number;
        step?: number;
        className?: string;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            className={className}
            aria-label={ariaLabel}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
    ),
}));

vi.mock('#/components/ui/disabled-feature-wrapper', () => ({
    DisabledFeatureWrapper: ({
        children,
        disabled,
        reason,
    }: {
        children: React.ReactNode;
        disabled: boolean;
        reason: string;
    }) => (
        <div data-disabled={disabled} data-reason={reason}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) {
                        classes.push(key);
                    }
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#151515'),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: vi.fn(),
    getCachedAudioBuffer: vi.fn(() => null),
    getCachedAudioBufferWaveformPeaks: vi.fn(() => new Float32Array([0.35, 0.15])),
    isDesktopRuntime: vi.fn(() => false),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        subscribe: vi.fn(() => () => undefined),
        get value() {
            return { tracks: [] };
        },
        getSnapshot: () => ({ tracks: [] }),
        subscribe: vi.fn<typeof trackStore.subscribe>((_callback) => () => {}),
        subscribeReact: vi.fn(() => () => {}),
    },
    defaultTrackState: { tracks: [] },
    getWarpState: vi.fn(() => ({ enabled: false, markers: [], stretchMode: 'complex', originalTempo: null })),
    warpStates: new Map(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    replaceClipAudioBuffer: vi.fn(),
    normalizeClip: vi.fn(),
    reverseClip: vi.fn(),
    moveWarpMarker: vi.fn(),
    addManualWarpMarker: vi.fn(),
    commitWarpMarkerBeatDrag: vi.fn(),
    removeWarpMarker: vi.fn(),
    setStretchMode: vi.fn(),
    disableWarp: vi.fn(),
    enableWarp: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiGeneration/useCases')>()),
    handleAiDenoiseClip: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    verifyAudioBufferReferences: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioAnalysis/useCases')>()),
    audioToMidi: vi.fn(),
}));

// Every clip this spec renders carries an analysed pitch contour. Pitch editing
// is Knead mode's job, and the waveform surface must be indifferent to it: the
// retired waveform-mode pitch overlay turned "this clip has a contour" into
// "this clip's waveform is dead". Serving a populated contour here is what makes
// that regression reachable — an empty one exercises nothing.
vi.mock('#/modules/Knead/stores', () => {
    const kneadStateWithContour = {
        activeClipId: null,
        clips: {},
        contours: {
            'clip-1': {
                points: [
                    { time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true },
                    { time_ms: 300, frequency_hz: 220, confidence: 0.9, voiced: true },
                ],
                sample_rate: 48000,
                hop_size: 256,
            },
        },
        isAnalyzing: false,
        analysisProgress: 0,
    };
    return {
        kneadStore: {
            get value() {
                return kneadStateWithContour;
            },
            getSnapshot: () => kneadStateWithContour,
            subscribe: vi.fn(() => () => {}),
            subscribeReact: vi.fn(() => () => {}),
            set: vi.fn(),
        },
        defaultKneadState: kneadStateWithContour,
    };
});

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue),
}));

describe('WaveformEditor', () => {
    const defaultProps = {
        clipId: 'clip-1',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        restore_property_descriptor(HTMLCanvasElement.prototype, 'getContext', original_canvas_get_context_descriptor);
        restore_property_descriptor(HTMLElement.prototype, 'clientWidth', original_client_width_descriptor);
        restore_property_descriptor(HTMLElement.prototype, 'clientHeight', original_client_height_descriptor);
    });

    it('should render without crashing', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Waveform zoom')).toBeInTheDocument();
    });

    it('should render zoom slider', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Waveform zoom')).toBeInTheDocument();
    });

    it('should render warp toggle button', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Toggle warp mode')).toBeInTheDocument();
    });

    it('should enable warp when the warp toggle is clicked while disabled', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.click(screen.getByLabelText('Toggle warp mode'));

        expect(vi.mocked(enableWarp)).toHaveBeenCalledWith('clip-1');
        expect(vi.mocked(disableWarp)).not.toHaveBeenCalled();
    });

    it('should disable warp when the warp toggle is clicked while enabled', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.click(screen.getByLabelText('Toggle warp mode'));

        expect(vi.mocked(disableWarp)).toHaveBeenCalledWith('clip-1');
        expect(vi.mocked(enableWarp)).not.toHaveBeenCalled();
    });

    // audit M-249 — ClipView renders this editor without a `key`, so selecting a
    // different clip reuses the instance and the once-seeded `warpState` describes
    // the clip the editor mounted with rather than the clip on screen.
    describe('warp state across clip switches (audit M-249)', () => {
        // The file-level `beforeEach` is `vi.clearAllMocks()`, which clears calls but
        // keeps implementations, so a `mockImplementation` installed here would stay
        // installed for every later test in the file and silently change what they
        // exercise. Put the module mock's own default back after each of these.
        afterEach(() => {
            vi.mocked(getWarpState).mockImplementation(() => ({
                enabled: false,
                markers: [],
                stretchMode: 'complex',
                originalTempo: null,
            }));
        });

        it('reads the newly selected clip marker count, not the count it mounted with', () => {
            // Both clips are warped, so the marker readout stays rendered across the
            // switch: only a re-read of the new clip can change the string.
            vi.mocked(getWarpState).mockImplementation((clipId: string) => {
                if (clipId === 'clip-a') {
                    return {
                        enabled: true,
                        markers: [
                            { id: 'marker-a1', originalBeat: 1, warpedBeat: 1 },
                            { id: 'marker-a2', originalBeat: 2, warpedBeat: 2.5 },
                            { id: 'marker-a3', originalBeat: 3, warpedBeat: 4 },
                        ],
                        stretchMode: 'repitch',
                        originalTempo: 120,
                    };
                }
                return {
                    enabled: true,
                    markers: [{ id: 'marker-b1', originalBeat: 8, warpedBeat: 9 }],
                    stretchMode: 'repitch',
                    originalTempo: 90,
                };
            });

            const { rerender } = render(<WaveformEditor clipId="clip-a" />);
            expect(screen.getByText('3 markers')).toBeInTheDocument();

            rerender(<WaveformEditor clipId="clip-b" />);

            expect(screen.getByText('1 marker')).toBeInTheDocument();
        });

        it('routes the first toggle after a switch into enableWarp when the new clip is unwarped', () => {
            vi.mocked(getWarpState).mockImplementation((clipId: string) => {
                if (clipId === 'clip-a') {
                    return {
                        enabled: true,
                        markers: [{ id: 'marker-a1', originalBeat: 1, warpedBeat: 1 }],
                        stretchMode: 'repitch',
                        originalTempo: 120,
                    };
                }
                return { enabled: false, markers: [], stretchMode: 'repitch', originalTempo: null };
            });

            const { rerender } = render(<WaveformEditor clipId="clip-a" />);
            rerender(<WaveformEditor clipId="clip-b" />);

            expect(screen.getByLabelText('Toggle warp mode')).toHaveAttribute('aria-pressed', 'false');

            fireEvent.click(screen.getByLabelText('Toggle warp mode'));

            expect(vi.mocked(enableWarp)).toHaveBeenCalledWith('clip-b');
            expect(vi.mocked(disableWarp)).not.toHaveBeenCalled();
        });

        it('routes the first toggle after a switch into disableWarp when the new clip is already warped', () => {
            vi.mocked(getWarpState).mockImplementation((clipId: string) => {
                if (clipId === 'clip-a') {
                    return { enabled: false, markers: [], stretchMode: 'repitch', originalTempo: null };
                }
                return {
                    enabled: true,
                    markers: [{ id: 'marker-b1', originalBeat: 2, warpedBeat: 2 }],
                    stretchMode: 'repitch',
                    originalTempo: 90,
                };
            });

            const { rerender } = render(<WaveformEditor clipId="clip-a" />);
            rerender(<WaveformEditor clipId="clip-b" />);

            expect(screen.getByLabelText('Toggle warp mode')).toHaveAttribute('aria-pressed', 'true');

            fireEvent.click(screen.getByLabelText('Toggle warp mode'));

            expect(vi.mocked(disableWarp)).toHaveBeenCalledWith('clip-b');
            expect(vi.mocked(enableWarp)).not.toHaveBeenCalled();
        });

        it('accepts the first double-click on the new clip after a marker drag on the previous one', () => {
            // Both clips are warped, so `handleDoubleClick`'s `!warpState.enabled`
            // guard is satisfied either way: only the latched drag flag can swallow
            // the double-click, which isolates this to the didDragRef reset.
            vi.mocked(getWarpState).mockImplementation((clipId: string) => {
                if (clipId === 'clip-a') {
                    return {
                        enabled: true,
                        markers: [{ id: 'marker-a1', originalBeat: 0.5, warpedBeat: 1 }],
                        stretchMode: 'repitch',
                        originalTempo: 120,
                    };
                }
                return { enabled: true, markers: [], stretchMode: 'repitch', originalTempo: 90 };
            });

            const { rerender } = render(<WaveformEditor clipId="clip-a" />);
            const canvas = screen.getByLabelText('Waveform editor');
            canvas.setPointerCapture = vi.fn();

            // Drag clip-a's marker past the 4px threshold that latches didDragRef.
            fireEvent.pointerDown(canvas, { clientX: 40, pointerId: 7 });
            fireEvent.pointerMove(canvas, { clientX: 84, pointerId: 7 });
            fireEvent.pointerUp(canvas, { pointerId: 7 });
            expect(vi.mocked(moveWarpMarker)).toHaveBeenCalledWith('clip-a', 'marker-a1', 2.1);

            rerender(<WaveformEditor clipId="clip-b" />);
            fireEvent.doubleClick(canvas, { clientX: 80 });

            expect(vi.mocked(addManualWarpMarker)).toHaveBeenCalledWith({ clipId: 'clip-b', beat: 2 });
        });
    });

    it('offers no warp stretch-mode button while repitch is the only executor', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1 }],
            stretchMode: 'repitch',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);

        // The warp-enabled strip renders — its marker readout only exists on
        // this branch, so the absences below are real, not a missing subtree.
        expect(screen.getByText('1 marker')).toBeInTheDocument();

        for (const mode of ['repitch', 'complex', 'texture', 'beats']) {
            expect(screen.queryByRole('button', { name: mode })).not.toBeInTheDocument();
        }
        expect(vi.mocked(setStretchMode)).not.toHaveBeenCalled();
    });

    it('should render canvas element', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Waveform editor')).toBeInTheDocument();
    });

    it('should request waveform peaks through the AudioEngine use case', () => {
        const canvasContext = {
            scale: vi.fn(),
            fillRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            closePath: vi.fn(),
            fill: vi.fn(),
            setLineDash: vi.fn(),
            fillText: vi.fn(),
        };
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: vi.fn((contextId: string) => {
                if (contextId === '2d') {
                    return canvasContext;
                }
                return null;
            }),
        });
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get: () => 127,
        });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get: () => 48,
        });

        render(<WaveformEditor {...defaultProps} />);

        expect(vi.mocked(getCachedAudioBufferWaveformPeaks)).toHaveBeenCalledWith({
            bufferId: 'clip-1',
            numBins: 127,
        });
    });

    it('should have correct aria-label for canvas', () => {
        render(<WaveformEditor {...defaultProps} />);
        expect(screen.getByLabelText('Waveform editor')).toBeInTheDocument();
    });

    it('should add manual warp marker through the Arrangement use case on double click', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.doubleClick(screen.getByLabelText('Waveform editor'), { clientX: 80 });

        expect(vi.mocked(addManualWarpMarker)).toHaveBeenCalledWith({ clipId: 'clip-1', beat: 2 });
    });

    // Regression: waveform mode used to mount a second pitch editor as a
    // full-bleed `absolute inset-0 z-10` overlay whose canvas switched to
    // `pointer-events-auto` as soon as a contour existed. Entering Knead mode
    // once creates that contour and persists it through the CRDT, so from then
    // on the clip's warp drags, double-clicks and whole context menu were dead
    // in waveform mode — permanently, for that clip.
    //
    // jsdom dispatches an event straight at the element named in `fireEvent`, so
    // it cannot reproduce the swallowing on its own: the structural assertions
    // are the ones that discriminate. They fail with the overlay restored (a
    // second canvas, carrying `pointer-events-auto`, layered over the waveform)
    // and pass with pitch editing left to Knead mode where it belongs.
    describe('waveform surface for a clip that already has a pitch contour', () => {
        const getWaveformSurface = (): HTMLElement =>
            screen.getByLabelText('Waveform editor').parentElement as HTMLElement;

        it('layers nothing over the waveform that takes the pointer', () => {
            render(<WaveformEditor {...defaultProps} />);
            const surface = getWaveformSurface();

            expect(surface.querySelectorAll('canvas')).toHaveLength(1);
            expect(surface.querySelectorAll('.pointer-events-auto')).toHaveLength(0);
        });

        it('still drags a warp marker', () => {
            vi.mocked(getWarpState).mockReturnValue({
                enabled: true,
                markers: [{ id: 'm1', originalBeat: 0.5, warpedBeat: 1 }],
                stretchMode: 'complex',
                originalTempo: null,
            });
            render(<WaveformEditor {...defaultProps} />);
            const canvas = screen.getByLabelText('Waveform editor');
            canvas.setPointerCapture = vi.fn();

            fireEvent.pointerDown(canvas, { clientX: 40, pointerId: 7 });
            fireEvent.pointerMove(canvas, { clientX: 84, pointerId: 7 });
            fireEvent.pointerUp(canvas, { pointerId: 7 });

            expect(vi.mocked(moveWarpMarker)).toHaveBeenCalledWith('clip-1', 'm1', 2.1);
        });

        it('still adds a warp marker on double click', () => {
            vi.mocked(getWarpState).mockReturnValue({
                enabled: true,
                markers: [],
                stretchMode: 'complex',
                originalTempo: null,
            });
            render(<WaveformEditor {...defaultProps} />);

            fireEvent.doubleClick(screen.getByLabelText('Waveform editor'), { clientX: 80 });

            expect(vi.mocked(addManualWarpMarker)).toHaveBeenCalledWith({ clipId: 'clip-1', beat: 2 });
        });

        it('still opens the context menu and runs its actions', () => {
            render(<WaveformEditor {...defaultProps} />);

            fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });
            expect(screen.getByRole('menu')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('menuitem', { name: 'Normalize' }));

            expect(vi.mocked(normalizeClip)).toHaveBeenCalledWith('clip-1');
        });
    });

    it('should run a waveform context menu action and close the menu', () => {
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });

        const normalizeMenuItem = screen.getByRole('menuitem', { name: 'Normalize' });
        expect(normalizeMenuItem.tagName).toBe('BUTTON');

        fireEvent.click(normalizeMenuItem);

        expect(vi.mocked(normalizeClip)).toHaveBeenCalledWith('clip-1');
        expect(screen.queryByRole('menuitem', { name: 'Normalize' })).not.toBeInTheDocument();
    });

    it('should commit marker drag undo on pointer up', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 0.5, warpedBeat: 1 }],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);
        const canvas = screen.getByLabelText('Waveform editor');
        canvas.setPointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, { clientX: 40, pointerId: 7 });
        fireEvent.pointerMove(canvas, { clientX: 84, pointerId: 7 });
        fireEvent.pointerUp(canvas, { pointerId: 7 });

        expect(vi.mocked(moveWarpMarker)).toHaveBeenCalledWith('clip-1', 'm1', 2.1);
        expect(vi.mocked(commitWarpMarkerBeatDrag)).toHaveBeenCalledWith({
            clipId: 'clip-1',
            markerId: 'm1',
            beforeOriginalBeat: 0.5,
            beforeWarpedBeat: 1,
        });
    });

    it('should commit marker drag undo on pointer cancel', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 0.5, warpedBeat: 1 }],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);
        const canvas = screen.getByLabelText('Waveform editor');
        canvas.setPointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, { clientX: 40, pointerId: 7 });
        fireEvent.pointerMove(canvas, { clientX: 84, pointerId: 7 });
        fireEvent.pointerCancel(canvas, { pointerId: 7 });

        expect(vi.mocked(commitWarpMarkerBeatDrag)).toHaveBeenCalledWith({
            clipId: 'clip-1',
            markerId: 'm1',
            beforeOriginalBeat: 0.5,
            beforeWarpedBeat: 1,
        });
    });

    it('should key waveform peaks on the clip audioBufferId, not the clip id', () => {
        const canvasContext = {
            scale: vi.fn(),
            fillRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            closePath: vi.fn(),
            fill: vi.fn(),
            setLineDash: vi.fn(),
            fillText: vi.fn(),
        };
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: vi.fn((contextId: string) => (contextId === '2d' ? canvasContext : null)),
        });
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            get: () => 127,
        });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get: () => 48,
        });

        render(<WaveformEditor clipId="clip-uuid" audioBufferId="audio-uuid" />);

        expect(vi.mocked(getCachedAudioBufferWaveformPeaks)).toHaveBeenCalledWith({
            bufferId: 'audio-uuid',
            numBins: 127,
        });
        expect(vi.mocked(getCachedAudioBufferWaveformPeaks)).not.toHaveBeenCalledWith(
            expect.objectContaining({ bufferId: 'clip-uuid' })
        );
    });

    it('should dispatch AI denoise on the clip audioBufferId, not the clip id', () => {
        render(<WaveformEditor clipId="clip-uuid" audioBufferId="audio-uuid" />);

        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });
        fireEvent.click(screen.getByRole('menuitem', { name: /AI Denoise/ }));

        expect(vi.mocked(handleAiDenoiseClip)).toHaveBeenCalledWith('audio-uuid');
    });

    it('should keep clip-model context actions keyed on the clip id', () => {
        render(<WaveformEditor clipId="clip-uuid" audioBufferId="audio-uuid" />);

        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Normalize' }));

        expect(vi.mocked(normalizeClip)).toHaveBeenCalledWith('clip-uuid');
    });

    it('should ignore a drop that carries no files', () => {
        render(<WaveformEditor {...defaultProps} />);
        const dropZone = screen.getByLabelText('Waveform editor').parentElement as HTMLElement;

        fireEvent.drop(dropZone, { dataTransfer: { files: [] } });

        expect(vi.mocked(decodeAudioFile)).not.toHaveBeenCalled();
        expect(vi.mocked(replaceClipAudioBuffer)).not.toHaveBeenCalled();
    });

    it('should ignore a drop of a non-audio file', () => {
        render(<WaveformEditor {...defaultProps} />);
        const dropZone = screen.getByLabelText('Waveform editor').parentElement as HTMLElement;
        const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });

        fireEvent.drop(dropZone, { dataTransfer: { files: [textFile] } });

        expect(vi.mocked(decodeAudioFile)).not.toHaveBeenCalled();
        expect(vi.mocked(replaceClipAudioBuffer)).not.toHaveBeenCalled();
    });

    it('should replace the clip audio buffer when an audio file is dropped', async () => {
        const decodedBuffer = {
            numberOfChannels: 1,
            length: 4,
            sampleRate: 48_000,
            getChannelData: () => new Float32Array(4),
            copyFromChannel: () => {},
            copyToChannel: () => {},
            duration: 4 / 48_000,
        } as AudioBuffer;
        vi.mocked(decodeAudioFile).mockResolvedValue({ id: 'audio-dropped', buffer: decodedBuffer });
        render(<WaveformEditor {...defaultProps} />);
        const dropZone = screen.getByLabelText('Waveform editor').parentElement as HTMLElement;
        const audioFile = new File(['data'], 'loop.wav', { type: 'audio/wav' });

        fireEvent.drop(dropZone, { dataTransfer: { files: [audioFile] } });

        await waitFor(() => {
            expect(vi.mocked(replaceClipAudioBuffer)).toHaveBeenCalledWith('clip-1', 'audio-dropped');
        });
        expect(vi.mocked(decodeAudioFile)).toHaveBeenCalledWith(audioFile);
    });

    it('re-scans missing media after a successful relink, so the panel stops counting the fixed clip', async () => {
        vi.mocked(replaceClipAudioBuffer).mockReturnValue(true);
        vi.mocked(decodeAudioFile).mockResolvedValue({
            id: 'audio-dropped',
            buffer: {
                sampleRate: 48_000,
                length: 4,
                numberOfChannels: 1,
                getChannelData: () => new Float32Array(4),
                copyFromChannel: () => {},
                copyToChannel: () => {},
                duration: 4 / 48_000,
            },
        });
        render(<WaveformEditor {...defaultProps} />);
        const dropZone = screen.getByLabelText('Waveform editor').parentElement as HTMLElement;

        fireEvent.drop(dropZone, {
            dataTransfer: { files: [new File(['data'], 'loop.wav', { type: 'audio/wav' })] },
        });

        await waitFor(() => {
            expect(vi.mocked(verifyAudioBufferReferences)).toHaveBeenCalledTimes(1);
        });
    });

    it('does not re-scan when the relink is rejected', async () => {
        vi.mocked(replaceClipAudioBuffer).mockReturnValue(false);
        vi.mocked(decodeAudioFile).mockResolvedValue({
            id: 'audio-dropped',
            buffer: {
                sampleRate: 48_000,
                length: 4,
                numberOfChannels: 1,
                getChannelData: () => new Float32Array(4),
                copyFromChannel: () => {},
                copyToChannel: () => {},
                duration: 4 / 48_000,
            },
        });
        render(<WaveformEditor {...defaultProps} />);
        const dropZone = screen.getByLabelText('Waveform editor').parentElement as HTMLElement;

        fireEvent.drop(dropZone, {
            dataTransfer: { files: [new File(['data'], 'loop.wav', { type: 'audio/wav' })] },
        });

        await waitFor(() => {
            expect(vi.mocked(replaceClipAudioBuffer)).toHaveBeenCalledWith('clip-1', 'audio-dropped');
        });
        expect(vi.mocked(verifyAudioBufferReferences)).not.toHaveBeenCalled();
    });

    it('should notify the user when decoding a dropped file fails', async () => {
        vi.mocked(decodeAudioFile).mockRejectedValue(new Error('bad format'));
        render(<WaveformEditor {...defaultProps} />);
        const dropZone = screen.getByLabelText('Waveform editor').parentElement as HTMLElement;
        const audioFile = new File(['data'], 'corrupt.wav', { type: 'audio/wav' });

        fireEvent.drop(dropZone, { dataTransfer: { files: [audioFile] } });

        await waitFor(() => {
            expect(vi.mocked(notifyUser)).toHaveBeenCalledWith(
                'Failed to import "corrupt.wav" — unsupported format or corrupt file',
                'error'
            );
        });
        expect(vi.mocked(replaceClipAudioBuffer)).not.toHaveBeenCalled();
    });

    it('should show the drop overlay while dragging over and hide it on drag leave', () => {
        render(<WaveformEditor {...defaultProps} />);
        const dropZone = screen.getByLabelText('Waveform editor').parentElement as HTMLElement;

        fireEvent.dragOver(dropZone);
        expect(screen.getByText('Drop audio file here')).toBeInTheDocument();

        fireEvent.dragLeave(dropZone);
        expect(screen.queryByText('Drop audio file here')).not.toBeInTheDocument();
    });

    it('should dismiss the context menu when clicking outside of it', () => {
        render(<WaveformEditor {...defaultProps} />);
        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });
        expect(screen.getByRole('menu')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should dismiss the context menu when Escape is pressed', () => {
        render(<WaveformEditor {...defaultProps} />);
        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });
        expect(screen.getByRole('menu')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should run the reverse action from the context menu', () => {
        render(<WaveformEditor {...defaultProps} />);
        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });

        fireEvent.click(screen.getByRole('menuitem', { name: 'Reverse' }));

        expect(vi.mocked(reverseClip)).toHaveBeenCalledWith('clip-1');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('should notify the user when AI denoise is attempted without an audio buffer', () => {
        render(<WaveformEditor {...defaultProps} />);
        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });

        fireEvent.click(screen.getByRole('menuitem', { name: /AI Denoise/ }));

        expect(vi.mocked(notifyUser)).toHaveBeenCalledWith('Denoise unavailable — clip has no audio buffer', 'error');
        expect(vi.mocked(handleAiDenoiseClip)).not.toHaveBeenCalled();
    });

    it('does not advertise unavailable stem separation', () => {
        render(<WaveformEditor {...defaultProps} />);
        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });
        expect(screen.queryByRole('menuitem', { name: /AI Stem Separation/ })).not.toBeInTheDocument();
    });

    it('should dispatch audio to MIDI for the track that contains the clip', () => {
        const clipFixture: Clip = {
            id: 'clip-1',
            trackId: 'track-1',
            name: 'Clip',
            startBeat: 0,
            endBeat: 4,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#000',
            locked: false,
            muted: false,
        };
        const track = normalizeTrack({ id: 'track-1', name: 'Track', kind: 'audio', clips: [clipFixture] });
        vi.mocked(useStore).mockImplementation((store: unknown, defaultValue: unknown) =>
            store === trackStore ? { tracks: [track], selectedTrackId: null, ghostClips: [] } : defaultValue
        );
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });
        fireEvent.click(screen.getByRole('menuitem', { name: /AI Audio → MIDI/ }));

        expect(vi.mocked(audioToMidi)).toHaveBeenCalledWith({ clipId: 'clip-1', trackId: 'track-1' });
    });

    it('should not dispatch audio to MIDI when no track contains the clip', () => {
        const track = normalizeTrack({ id: 'track-1', name: 'Track', kind: 'audio', clips: [] });
        vi.mocked(useStore).mockImplementation((store: unknown, defaultValue: unknown) =>
            store === trackStore ? { tracks: [track], selectedTrackId: null, ghostClips: [] } : defaultValue
        );
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });
        fireEvent.click(screen.getByRole('menuitem', { name: /AI Audio → MIDI/ }));

        expect(vi.mocked(audioToMidi)).not.toHaveBeenCalled();
    });

    it('should enable warp from the context menu when disabled', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);
        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });

        fireEvent.click(screen.getByRole('menuitem', { name: 'Enable Warp' }));

        expect(vi.mocked(enableWarp)).toHaveBeenCalledWith('clip-1');
        expect(vi.mocked(disableWarp)).not.toHaveBeenCalled();
    });

    it('should disable warp from the context menu when enabled', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);
        fireEvent.contextMenu(screen.getByLabelText('Waveform editor'), { clientX: 32, clientY: 48 });

        fireEvent.click(screen.getByRole('menuitem', { name: 'Disable Warp' }));

        expect(vi.mocked(disableWarp)).toHaveBeenCalledWith('clip-1');
        expect(vi.mocked(enableWarp)).not.toHaveBeenCalled();
    });

    it('should update the zoom level from the zoom slider', () => {
        render(<WaveformEditor {...defaultProps} />);
        const zoomSlider = screen.getByLabelText('Waveform zoom');

        fireEvent.change(zoomSlider, { target: { value: '200' } });

        expect((zoomSlider as HTMLInputElement).value).toBe('200');
    });

    it('should remove an existing warp marker on double click', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 2, warpedBeat: 2 }],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.doubleClick(screen.getByLabelText('Waveform editor'), { clientX: 80 });

        expect(vi.mocked(removeWarpMarker)).toHaveBeenCalledWith('clip-1', 'm1');
        expect(vi.mocked(addManualWarpMarker)).not.toHaveBeenCalled();
    });

    it('should ignore double click when warp is disabled', () => {
        vi.mocked(getWarpState).mockReturnValue({
            enabled: false,
            markers: [],
            stretchMode: 'complex',
            originalTempo: null,
        });
        render(<WaveformEditor {...defaultProps} />);

        fireEvent.doubleClick(screen.getByLabelText('Waveform editor'), { clientX: 80 });

        expect(vi.mocked(addManualWarpMarker)).not.toHaveBeenCalled();
        expect(vi.mocked(removeWarpMarker)).not.toHaveBeenCalled();
    });

    // An all-zero peak array is what the buffer cache returns for BOTH a cache
    // miss and a digitally silent buffer, so peak amplitude alone cannot decide
    // which one is on screen. Deciding on it painted the placeholder sine bars
    // and "drop an audio file" over silent audio that had loaded perfectly well.
    describe('empty-looking peaks', () => {
        const installCanvasStub = (): { fillText: ReturnType<typeof vi.fn>; fill: ReturnType<typeof vi.fn> } => {
            const canvasContext = {
                scale: vi.fn(),
                fillRect: vi.fn(),
                beginPath: vi.fn(),
                moveTo: vi.fn(),
                lineTo: vi.fn(),
                stroke: vi.fn(),
                closePath: vi.fn(),
                fill: vi.fn(),
                setLineDash: vi.fn(),
                fillText: vi.fn(),
            };
            Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
                configurable: true,
                value: vi.fn((contextId: string) => (contextId === '2d' ? canvasContext : null)),
            });
            Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 127 });
            Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 48 });
            return canvasContext;
        };

        // The file-level `beforeEach` is `vi.clearAllMocks()`, which clears calls
        // but keeps implementations — so a `mockReturnValue` installed here would
        // stay installed for every later test in the file. Put the module mock's
        // own defaults back.
        afterEach(() => {
            vi.mocked(getCachedAudioBuffer).mockImplementation(() => null);
            vi.mocked(getCachedAudioBufferWaveformPeaks).mockImplementation(() => new Float32Array([0.35, 0.15]));
        });

        it('should render placeholder waveform bars and the drop hint when no buffer is loaded', () => {
            vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
            vi.mocked(getCachedAudioBufferWaveformPeaks).mockReturnValue(new Float32Array([0, 0, 0]));
            const canvasContext = installCanvasStub();

            render(<WaveformEditor {...defaultProps} />);

            expect(canvasContext.fillText).toHaveBeenCalledWith(
                'Audio clip — drop an audio file to load waveform',
                expect.any(Number),
                expect.any(Number)
            );
        });

        it('should draw a flat line and no drop hint for a loaded but silent buffer', () => {
            vi.mocked(getCachedAudioBuffer).mockReturnValue({
                numberOfChannels: 1,
                length: 4,
                sampleRate: 48_000,
                duration: 4 / 48_000,
                getChannelData: () => new Float32Array(4),
                copyFromChannel: () => {},
                copyToChannel: () => {},
            });
            vi.mocked(getCachedAudioBufferWaveformPeaks).mockReturnValue(new Float32Array([0, 0, 0]));
            const canvasContext = installCanvasStub();

            render(<WaveformEditor {...defaultProps} />);

            // The clip holds audio; telling the user to drop a file would be a lie.
            expect(canvasContext.fillText).not.toHaveBeenCalledWith(
                'Audio clip — drop an audio file to load waveform',
                expect.any(Number),
                expect.any(Number)
            );
            // The peak path ran instead, which at zero amplitude is a flat line.
            expect(canvasContext.fill).toHaveBeenCalled();
        });
    });

    it('should not throw when the canvas cannot provide a 2d context', () => {
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: vi.fn(() => null),
        });

        expect(() => render(<WaveformEditor {...defaultProps} />)).not.toThrow();
    });

    it('should redraw the waveform when the ResizeObserver reports a resize', () => {
        class MockResizeObserver {
            private readonly callback: ResizeObserverCallback;
            constructor(callback: ResizeObserverCallback) {
                this.callback = callback;
            }
            observe(): void {
                this.callback([], this);
            }
            unobserve(): void {}
            disconnect(): void {}
        }
        const originalResizeObserver = global.ResizeObserver;
        global.ResizeObserver = MockResizeObserver;

        expect(() => render(<WaveformEditor {...defaultProps} />)).not.toThrow();

        global.ResizeObserver = originalResizeObserver;
    });
});
