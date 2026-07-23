import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { useStore } from '#/infra/store/useStore';
import { addDevice } from '#/modules/Arrangement/useCases';
import { type KneadClipState, type NoteBlob } from '#/modules/Knead/stores';
import { analyzeClipPitch, updateClipKneadState } from '#/modules/Knead/useCases';
import { setProjectKeyRoot, setProjectScaleName } from '#/modules/Project/useCases';
import { defaultTransportState } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { useTracks } from '../../../hooks/useTracks';
import { KneadEditor } from '../KneadEditor';

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        size,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        variant?: string;
        size?: string;
    }) => (
        <button type="button" onClick={onClick} data-variant={variant} data-size={size}>
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
    }: {
        value: number[];
        onValueChange: (v: number[]) => void;
        min?: number;
        max?: number;
        step?: number;
        className?: string;
    }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            className={className}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
    ),
}));

vi.mock('#/components/daw/DawCompactCheckbox', () => ({
    DawCompactCheckbox: ({
        checked,
        onChange,
        id,
        className,
    }: {
        checked: boolean;
        onChange: (e: { target: { checked: boolean } }) => void;
        id?: string;
        className?: string;
    }) => (
        <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange({ target: { checked: event.target.checked } })}
            id={id}
            className={className}
        />
    ),
}));

vi.mock('#/modules/Knead/stores', () => ({
    kneadStore: { value: { clips: {} } },
}));

vi.mock('#/modules/Knead/useCases', () => ({
    updateClipKneadState: vi.fn(),
    analyzeClipPitch: vi.fn(() => Promise.resolve({ status: 'no-buffer', reason: 'missing-clip-or-buffer' })),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue ?? {}),
}));

vi.mock('../../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [] })),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addDevice: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    setProjectKeyRoot: vi.fn(),
    setProjectScaleName: vi.fn(),
}));

describe('KneadEditor', () => {
    const defaultProps = {
        trackId: 'track-1',
        clipId: 'clip-1',
    };

    beforeEach(() => {
        const emit = vi.fn().mockResolvedValue(undefined);
        injectDependencies(notifyUser, { eventBus: { emit } });
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Pitch Correction Disabled')).toBeInTheDocument();
    });

    it('should render enable pitch editor button when no knead device', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Enable Pitch Editor')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Enable Pitch Editor'));
        expect(addDevice).toHaveBeenCalledWith('track-1', 'Knead');
    });

    it('should render canvas element', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('should display disabled state icon', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Pitch Correction Disabled')).toBeInTheDocument();
    });

    it('should show description text when disabled', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText(/Enable Knead on this track/)).toBeInTheDocument();
    });

    // Regression (Observation 2): a clip that analyses successfully but yields
    // no blobs must NOT keep re-triggering analysis. Once a contour exists the
    // analysis has run, so the effect must treat empty blobs + a contour as a
    // terminal state, not as "never analysed".
    describe('empty-result analysis loop', () => {
        const kneadTrack = {
            id: 'track-1',
            devices: [{ type: 'Knead' }],
            clips: [{ id: 'clip-1' }],
        };

        beforeEach(() => {
            vi.mocked(useTracks).mockReturnValue({ tracks: [kneadTrack] } as never);
        });

        afterEach(() => {
            // Restore the default useStore stub for the outer suite's tests.
            vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => fallback ?? {});
            vi.mocked(useTracks).mockReturnValue({ tracks: [] } as never);
        });

        it('does not re-trigger analysis once a contour exists but blobs are empty', () => {
            vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                // The kneadStore read: analysed-but-empty terminal state.
                if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                    return {
                        activeClipId: null,
                        clips: { 'clip-1': { clipId: 'clip-1', blobs: [] } },
                        contours: { 'clip-1': { points: [], sample_rate: 48000, hop_size: 256 } },
                        isAnalyzing: false,
                        analysisProgress: 0,
                    };
                }
                return fallback ?? {};
            });

            render(<KneadEditor {...defaultProps} />);

            expect(analyzeClipPitch).not.toHaveBeenCalled();
            expect(screen.getByText('No pitch detected in this clip.')).toBeInTheDocument();
        });

        it('triggers analysis when no contour has been computed yet', () => {
            vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                    return {
                        activeClipId: null,
                        clips: {},
                        contours: {},
                        isAnalyzing: false,
                        analysisProgress: 0,
                    };
                }
                return fallback ?? {};
            });

            render(<KneadEditor {...defaultProps} />);

            expect(analyzeClipPitch).toHaveBeenCalledWith('clip-1');
        });

        it('logs and notifies when pitch analysis rejects', async () => {
            vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                    return {
                        activeClipId: null,
                        clips: {},
                        contours: {},
                        isAnalyzing: false,
                        analysisProgress: 0,
                    };
                }
                return fallback ?? {};
            });
            const emit = vi.fn().mockResolvedValue(undefined);
            injectDependencies(notifyUser, { eventBus: { emit } });
            vi.mocked(analyzeClipPitch).mockRejectedValueOnce(new Error('analysis exploded'));

            render(<KneadEditor {...defaultProps} />);

            await vi.waitFor(() => {
                expect(emit).toHaveBeenCalled();
            });
            expect(emit.mock.calls.some((call) => JSON.stringify(call).includes('Pitch analysis failed'))).toBe(true);
        });
    });

    describe('analyzed clip editing', () => {
        const kneadTrack = {
            id: 'track-1',
            devices: [{ type: 'Knead' }],
            clips: [{ id: 'clip-1' }],
        };

        // Geometry: zoom 1 → 300 px/s; canvas height 0 in jsdom → the blob row
        // centre sits at y = 0 (single blob ⇒ avgCents = its own cents).
        // blob: startTime 0.1 → x 30, endTime 0.5 → x 150, rowHeight 24 → y ±12.
        const makeBlob = (overrides: Partial<NoteBlob> = {}): NoteBlob => ({
            id: 'blob-1',
            startTime: 0.1,
            endTime: 0.5,
            pitchCenterCents: 6000,
            originalPitchCenterCents: 6000,
            pitchCurveCents: [],
            voicedConfidence: 0.9,
            driftPercent: 0,
            vibratoDepthPercent: 0,
            vibratoRateHz: 0,
            formantShiftCents: 0,
            gainDb: 0,
            muted: false,
            ...overrides,
        });

        const makeClipState = (blobs: NoteBlob[]): KneadClipState => ({
            clipId: 'clip-1',
            blobs,
            retuneSpeedMs: 25,
            toleranceCents: 0,
            toleranceTimeMs: 0,
            humanizePercent: 40,
            formantPreserve: true,
        });

        const installAnalyzedState = (clipState: KneadClipState): void => {
            vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                    return {
                        activeClipId: null,
                        clips: { 'clip-1': clipState },
                        contours: {},
                        isAnalyzing: false,
                        analysisProgress: 0,
                    };
                }
                if (fallback && typeof fallback === 'object' && 'isPlaying' in fallback) {
                    return fallback;
                }
                // projectStore read (no fallback provided by the component)
                return { keyRoot: 0, scaleName: 'major' };
            });
        };

        const lastUpdater = (): ((state: KneadClipState) => KneadClipState) => {
            const call = vi.mocked(updateClipKneadState).mock.lastCall;
            expect(call).toBeDefined();
            return call![1];
        };

        beforeEach(() => {
            vi.mocked(useTracks).mockReturnValue({ tracks: [kneadTrack] } as never);
            installAnalyzedState(makeClipState([makeBlob()]));
        });

        afterEach(() => {
            vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => fallback ?? {});
            vi.mocked(useTracks).mockReturnValue({ tracks: [] } as never);
        });

        describe('toolbar', () => {
            it('retune and humanize sliders write through updateClipKneadState', () => {
                render(<KneadEditor {...defaultProps} />);
                const sliders = screen.getAllByRole('slider');

                fireEvent.change(sliders[0]!, { target: { value: '80' } });
                expect(lastUpdater()(makeClipState([makeBlob()])).retuneSpeedMs).toBe(80);

                fireEvent.change(sliders[1]!, { target: { value: '70' } });
                expect(lastUpdater()(makeClipState([makeBlob()])).humanizePercent).toBe(70);
            });

            it('key and scale selects write the project settings', () => {
                render(<KneadEditor {...defaultProps} />);
                const selects = screen.getAllByRole('combobox');

                fireEvent.change(selects[0]!, { target: { value: '2' } });
                expect(setProjectKeyRoot).toHaveBeenCalledWith(2);

                fireEvent.change(selects[1]!, { target: { value: 'minor' } });
                expect(setProjectScaleName).toHaveBeenCalledWith('minor');
            });

            it('Correct All quantizes every blob to the project scale', () => {
                installAnalyzedState(makeClipState([makeBlob({ pitchCenterCents: 6100 })]));
                render(<KneadEditor {...defaultProps} />);

                fireEvent.click(screen.getByText('Correct All'));

                // 6100 cents = C#4 → nearest C-major degree is C (6000) with root C
                const next = lastUpdater()(makeClipState([makeBlob({ pitchCenterCents: 6100 })]));
                expect(next.blobs[0]?.pitchCenterCents).toBe(6000);
            });

            it('the formants checkbox toggles formantPreserve', () => {
                render(<KneadEditor {...defaultProps} />);

                fireEvent.click(screen.getByRole('checkbox'));

                expect(lastUpdater()(makeClipState([makeBlob()])).formantPreserve).toBe(false);
            });

            it('the zoom slider updates the zoom percentage shown on the control', () => {
                render(<KneadEditor {...defaultProps} />);
                const sliders = screen.getAllByRole('slider');
                const zoomSlider = sliders[sliders.length - 1]! as HTMLInputElement;
                expect(zoomSlider.value).toBe('100');

                fireEvent.change(zoomSlider, { target: { value: '150' } });

                expect(zoomSlider.value).toBe('150');
            });
        });

        describe('blob pointer interactions', () => {
            const getCanvas = (): HTMLCanvasElement => {
                const canvas = document.querySelector('canvas');
                expect(canvas).not.toBeNull();
                return canvas!;
            };

            it('hover reports resize, retune, and move affordances via the cursor', () => {
                render(<KneadEditor {...defaultProps} />);
                const canvas = getCanvas();

                fireEvent.pointerMove(canvas, { clientX: 35, clientY: 2 });
                expect(canvas.style.cursor).toBe('ew-resize');

                fireEvent.pointerMove(canvas, { clientX: 90, clientY: -6 });
                expect(canvas.style.cursor).toBe('ns-resize');

                fireEvent.pointerMove(canvas, { clientX: 90, clientY: -2 });
                expect(canvas.style.cursor).toBe('pointer');

                fireEvent.pointerMove(canvas, { clientX: 90, clientY: 2 });
                expect(canvas.style.cursor).toBe('move');

                fireEvent.pointerMove(canvas, { clientX: 300, clientY: 2 });
                expect(canvas.style.cursor).toBe('crosshair');

                fireEvent.pointerMove(canvas, { clientX: 90, clientY: 6 });
                expect(canvas.style.cursor).toBe('ns-resize');
            });

            it('dragging the lower centre shifts pitch freely in cents', () => {
                render(<KneadEditor {...defaultProps} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 90, clientY: 2 });
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 90, clientY: -10 });

                // dy = -12 px over a 24 px row → +50 cents, unquantized
                const next = lastUpdater()(makeClipState([makeBlob()]));
                expect(next.blobs[0]?.pitchCenterCents).toBe(6050);
            });

            it('dragging the upper centre snaps the shift to whole semitones', () => {
                render(<KneadEditor {...defaultProps} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 90, clientY: -2 });
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 90, clientY: -14 });

                // +50 cents quantized to the nearest semitone → +100
                const next = lastUpdater()(makeClipState([makeBlob()]));
                expect(next.blobs[0]?.pitchCenterCents).toBe(6100);
            });

            it('dragging the left edge trims the start time with a minimum span', () => {
                render(<KneadEditor {...defaultProps} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 32, clientY: 2 });
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 62, clientY: 2 });

                // +30 px at 300 px/s → +0.1 s
                const next = lastUpdater()(makeClipState([makeBlob()]));
                expect(next.blobs[0]?.startTime).toBeCloseTo(0.2);
            });

            it('dragging the right edge extends the end time', () => {
                render(<KneadEditor {...defaultProps} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 145, clientY: 2 });
                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 175, clientY: 2 });

                const next = lastUpdater()(makeClipState([makeBlob()]));
                expect(next.blobs[0]?.endTime).toBeCloseTo(0.6);
            });

            it('pointer-up ends the drag: further movement only updates hover state', () => {
                render(<KneadEditor {...defaultProps} />);
                const canvas = getCanvas();

                fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 90, clientY: 2 });
                fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 90, clientY: 2 });
                vi.mocked(updateClipKneadState).mockClear();

                fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 90, clientY: -10 });

                expect(updateClipKneadState).not.toHaveBeenCalled();
            });
        });

        describe('canvas draw loop', () => {
            type GetContext2d = (
                contextId: '2d',
                options?: CanvasRenderingContext2DSettings
            ) => CanvasRenderingContext2D | null;

            const make2dContext = (): CanvasRenderingContext2D => document.createElement('canvas').getContext('2d')!;

            const spyOnGetContext = (ctx: CanvasRenderingContext2D | null): ReturnType<typeof vi.spyOn> => {
                const proto: { getContext: GetContext2d } = HTMLCanvasElement.prototype;
                return vi.spyOn(proto, 'getContext').mockReturnValue(ctx);
            };

            const stubContainerSize = (width: number, height: number): (() => void) => {
                const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
                const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
                Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: width });
                Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: height });
                return () => {
                    if (widthDescriptor) {
                        Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
                    }
                    if (heightDescriptor) {
                        Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDescriptor);
                    }
                };
            };

            it('draws grid lines, the raw contour, and blob shapes with the playhead when pitch data is present', () => {
                const restoreSize = stubContainerSize(800, 240);
                const ctx = make2dContext();
                const getContextSpy = spyOnGetContext(ctx);
                const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
                const fillTextSpy = vi.spyOn(ctx, 'fillText');
                const roundRectSpy = vi.spyOn(ctx, 'roundRect');
                const moveToSpy = vi.spyOn(ctx, 'moveTo');
                const strokeSpy = vi.spyOn(ctx, 'stroke');

                vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                    if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                        return {
                            activeClipId: null,
                            clips: { 'clip-1': makeClipState([makeBlob({ pitchCurveCents: [10, -10, 5] })]) },
                            contours: {
                                'clip-1': {
                                    points: [{ time_ms: 100, frequency_hz: 440, confidence: 0.9, voiced: true }],
                                    sample_rate: 48000,
                                    hop_size: 256,
                                },
                            },
                            isAnalyzing: false,
                            analysisProgress: 0,
                        };
                    }
                    if (fallback && typeof fallback === 'object' && 'isPlaying' in fallback) {
                        return { ...defaultTransportState, isPlaying: true, playheadPosition: 2 };
                    }
                    return { keyRoot: 0, scaleName: 'major' };
                });

                render(<KneadEditor {...defaultProps} />);

                expect(getContextSpy).toHaveBeenCalledWith('2d');
                expect(roundRectSpy).toHaveBeenCalled();
                expect(moveToSpy).toHaveBeenCalled();
                expect(strokeSpy.mock.calls.length).toBeGreaterThan(0);
                expect(fillTextSpy).not.toHaveBeenCalledWith(
                    'No pitch data analyzed.',
                    expect.any(Number),
                    expect.any(Number)
                );
                expect(rafSpy).toHaveBeenCalled();

                getContextSpy.mockRestore();
                rafSpy.mockRestore();
                restoreSize();
            });

            it('draws the empty-state text on the canvas when no blobs have been analyzed', () => {
                const ctx = make2dContext();
                const getContextSpy = spyOnGetContext(ctx);
                const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
                const fillTextSpy = vi.spyOn(ctx, 'fillText');

                vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                    if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                        return {
                            activeClipId: null,
                            clips: {},
                            contours: {},
                            isAnalyzing: false,
                            analysisProgress: 0,
                        };
                    }
                    if (fallback && typeof fallback === 'object' && 'isPlaying' in fallback) {
                        return fallback;
                    }
                    return { keyRoot: 0, scaleName: 'major' };
                });

                render(<KneadEditor {...defaultProps} />);

                expect(fillTextSpy).toHaveBeenCalledWith(
                    'No pitch data analyzed.',
                    expect.any(Number),
                    expect.any(Number)
                );

                getContextSpy.mockRestore();
                rafSpy.mockRestore();
            });
        });
    });
});
