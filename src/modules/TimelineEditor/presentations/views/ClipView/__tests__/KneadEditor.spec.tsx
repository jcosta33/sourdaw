import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { useStore } from '#/infra/store/useStore';
import { compileAddDeviceAction } from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { type KneadClipState, type NoteBlob } from '#/modules/Knead/stores';
import { analyzeClipPitch, updateClipKneadState } from '#/modules/Knead/useCases';
import { setProjectKeyRoot, setProjectScaleName } from '#/modules/Project/useCases';
import { defaultTransportState } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { useTracks } from '../../../hooks/useTracks';
import { KneadEditor } from '../KneadEditor';

const actionMocks = vi.hoisted(() => ({
    compileAddDeviceAction: vi.fn(),
    executeAppAction: vi.fn(),
}));

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
    compileAddDeviceAction: actionMocks.compileAddDeviceAction,
}));

// Was previously registered twice for this specifier; the second registration
// silently shadowed this one and disconnected `executeAppAction` from
// `actionMocks.executeAppAction`, which the assertions below configure and
// read back through the real import. Keep exactly one registration.
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: actionMocks.executeAppAction,
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
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
        actionMocks.compileAddDeviceAction.mockReturnValue({
            type: 'addDevice',
            payload: { trackId: 'track-1', deviceType: 'Knead', deviceId: 'device-knead', expectedDeviceIds: [] },
        });
        actionMocks.executeAppAction.mockResolvedValue(undefined);
    });

    it('should render without crashing', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Pitch Correction Disabled')).toBeInTheDocument();
    });

    it('should render enable pitch editor button when no knead device', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Enable Pitch Editor')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Enable Pitch Editor'));
        expect(compileAddDeviceAction).toHaveBeenCalledWith('track-1', 'Knead');
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'addDevice',
            payload: { trackId: 'track-1', deviceType: 'Knead', deviceId: 'device-knead', expectedDeviceIds: [] },
        });
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

        // Baking a pitch edit into new audio is the one destructive step in the
        // Knead workflow, and this mode is the only place the product edits pitch
        // — so the control lives here. The action contract is unchanged from the
        // dispatch it replaces: `commitPitchEdit` with the clip id, the per-blob
        // shift segments, and the analysed contour.
        describe('pitch commit', () => {
            const contour = {
                points: [
                    { time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true },
                    { time_ms: 500, frequency_hz: 220, confidence: 0.9, voiced: true },
                ],
                sample_rate: 48000,
                hop_size: 256,
            };

            const installKneadStoreState = (kneadStoreState: {
                clips: Record<string, unknown>;
                contours: Record<string, unknown>;
                analysisProgress?: number;
            }): void => {
                vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                    if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                        return {
                            activeClipId: null,
                            isAnalyzing: false,
                            analysisProgress: 0,
                            ...kneadStoreState,
                        };
                    }
                    if (fallback && typeof fallback === 'object' && 'isPlaying' in fallback) {
                        return fallback;
                    }
                    return { keyRoot: 0, scaleName: 'major' };
                });
            };

            const installAnalyzedStateWithContour = (clipState: KneadClipState): void => {
                installKneadStoreState({ clips: { 'clip-1': clipState }, contours: { 'clip-1': contour } });
            };

            beforeEach(() => {
                vi.mocked(executeAppAction).mockResolvedValue(undefined);
            });

            it('dispatches commitPitchEdit with a shift segment per blob', () => {
                installAnalyzedStateWithContour(
                    makeClipState([
                        // Dragged up three semitones: 6000 -> 6300 cents over 0.1–0.5 s.
                        makeBlob({ pitchCenterCents: 6300, originalPitchCenterCents: 6000 }),
                        makeBlob({
                            id: 'blob-2',
                            startTime: 0.6,
                            endTime: 0.9,
                            pitchCenterCents: 6000,
                            originalPitchCenterCents: 6000,
                        }),
                    ])
                );
                render(<KneadEditor {...defaultProps} />);

                fireEvent.click(screen.getByText('Bounce & Commit'));

                expect(executeAppAction).toHaveBeenCalledWith({
                    type: 'commitPitchEdit',
                    payload: {
                        clipId: 'clip-1',
                        segments: [
                            { start_time_ms: 100, end_time_ms: 500, shift_semitones: 3 },
                            { start_time_ms: 600, end_time_ms: 900, shift_semitones: 0 },
                        ],
                        contour,
                    },
                });
            });

            // The commit drops the whole analysis — contour and blobs together — and a
            // fresh analysis of the rendered audio restores both, rebuilding every blob
            // with its original pitch rebased onto the new audio. Offering the control
            // without a contour would let the same shift be baked in twice.
            it('offers no commit control until an analysis has produced a contour', () => {
                installAnalyzedState(makeClipState([makeBlob({ pitchCenterCents: 6300 })]));
                render(<KneadEditor {...defaultProps} />);

                expect(screen.queryByText('Bounce & Commit')).not.toBeInTheDocument();
            });

            it('offers no commit control for a contour that yielded no editable blobs', () => {
                installAnalyzedStateWithContour(makeClipState([]));
                render(<KneadEditor {...defaultProps} />);

                expect(screen.queryByText('Bounce & Commit')).not.toBeInTheDocument();
            });

            // This is what makes pitch editing repeatable. The analysis effect is the
            // product's only caller of `analyzeClipPitch` and it fires only when a clip
            // has neither blobs nor a contour, so a commit that dropped the contour but
            // left the blobs standing left the clip permanently un-analysable — and
            // because blobs are CRDT-persisted, permanently across reloads and for every
            // collaborator, with nothing on screen to say why.
            it('re-analyses the clip after a commit and gives the commit control back', () => {
                // Post-commit: the whole analysis is gone.
                installKneadStoreState({ clips: { 'clip-1': makeClipState([]) }, contours: {} });
                const postCommit = render(<KneadEditor {...defaultProps} />);

                expect(analyzeClipPitch).toHaveBeenCalledWith('clip-1');
                expect(screen.queryByText('Bounce & Commit')).not.toBeInTheDocument();
                postCommit.unmount();

                // What that analysis produces: blobs rebased onto the rendered audio,
                // plus its contour.
                installAnalyzedStateWithContour(makeClipState([makeBlob()]));
                render(<KneadEditor {...defaultProps} />);

                expect(screen.getByText('Bounce & Commit')).toBeInTheDocument();
            });

            // The disabled state is an absolute overlay; it does not trap focus, so a
            // control rendered behind it stays reachable with Tab and Enter. Firing a
            // destructive render from a screen that reads "Pitch Correction Disabled"
            // is not a state the user can be in.
            it('offers no commit control on a track without a Knead device', () => {
                vi.mocked(useTracks).mockReturnValue({ tracks: [] } as never);
                installAnalyzedStateWithContour(makeClipState([makeBlob({ pitchCenterCents: 6300 })]));
                render(<KneadEditor {...defaultProps} />);

                expect(screen.getByText('Pitch Correction Disabled')).toBeInTheDocument();
                expect(screen.queryByText('Bounce & Commit')).not.toBeInTheDocument();
            });

            // `originalPitchCenterCents` is optional in the persisted blob shape, and
            // hydration widens it straight into the store — so a blob written before the
            // field existed arrives with it missing. Subtracting it yields NaN,
            // `JSON.stringify` emits null, and the Rust side fails the WHOLE segment
            // array on one bad element: every other blob's edit silently discarded, a
            // zero shift rendered, the clip repointed at it.
            it('renders a finite shift for a blob that has no original pitch recorded', () => {
                const { originalPitchCenterCents: _absent, ...legacyBlob } = makeBlob({ pitchCenterCents: 6300 });
                installKneadStoreState({
                    clips: { 'clip-1': { ...makeClipState([]), blobs: [legacyBlob] } },
                    contours: { 'clip-1': contour },
                });
                render(<KneadEditor {...defaultProps} />);

                fireEvent.click(screen.getByText('Bounce & Commit'));

                expect(executeAppAction).toHaveBeenCalledWith({
                    type: 'commitPitchEdit',
                    payload: {
                        clipId: 'clip-1',
                        // No original means no shift, the same fallback the Knead worklet
                        // applies — not NaN, and not a dropped array.
                        segments: [{ start_time_ms: 100, end_time_ms: 500, shift_semitones: 0 }],
                        contour,
                    },
                });
            });
        });

        // `analysisProgress` is reported by the analyser and was read by nothing: an
        // indeterminate spinner leaves a long take indistinguishable from a hang.
        it('shows how far the pitch analysis has got', () => {
            vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                    return {
                        activeClipId: null,
                        clips: {},
                        contours: {},
                        isAnalyzing: true,
                        analysisProgress: 0.42,
                    };
                }
                if (fallback && typeof fallback === 'object' && 'isPlaying' in fallback) {
                    return fallback;
                }
                return { keyRoot: 0, scaleName: 'major' };
            });

            render(<KneadEditor {...defaultProps} />);

            expect(screen.getByText('Analyzing pitch tracking data...')).toBeInTheDocument();
            expect(screen.getByText('42%')).toBeInTheDocument();
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

            // Teardown is registered here and drained in `afterEach`, never at the
            // end of a test body: a failing assertion throws, and end-of-body
            // restores would then silently not run and leak a prototype stub or a
            // spy into every later test in this file.
            const cleanups: (() => void)[] = [];

            afterEach(() => {
                while (cleanups.length > 0) {
                    const undo = cleanups.pop();
                    undo?.();
                }
            });

            const spyOnGetContext = (ctx: CanvasRenderingContext2D | null): MockInstance<GetContext2d> => {
                const proto: { getContext: GetContext2d } = HTMLCanvasElement.prototype;
                const spy = vi.spyOn(proto, 'getContext').mockReturnValue(ctx);
                cleanups.push(() => spy.mockRestore());
                return spy;
            };

            const setContainerSize = (width: number, height: number): void => {
                Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: width });
                Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: height });
            };

            // jsdom defines clientWidth/clientHeight on `Element.prototype`, so the
            // stub is an *own* property of `HTMLElement.prototype` and undoing it
            // means deleting it. Reading a descriptor off `HTMLElement.prototype`
            // first returns undefined, which made the old restore a silent no-op and
            // leaked the stubbed size into every later test in this file.
            const stubContainerSize = (width: number, height: number): void => {
                setContainerSize(width, height);
                cleanups.push(() => {
                    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
                    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
                });
            };

            it('draws grid lines, the raw contour, and blob shapes with the playhead when pitch data is present', () => {
                stubContainerSize(800, 240);
                const ctx = make2dContext();
                const getContextSpy = spyOnGetContext(ctx);
                const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
                cleanups.push(() => rafSpy.mockRestore());
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
            });

            it('draws the empty-state text on the canvas when no blobs have been analyzed', () => {
                const ctx = make2dContext();
                spyOnGetContext(ctx);
                const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
                cleanups.push(() => rafSpy.mockRestore());
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
            });

            // Guards for the render-loop dirty check (audit M-246). The check has to
            // hold in both directions: an idle animation frame must not repaint, and
            // every input the draw reads must repaint when it changes. There is one
            // test per leg of the painted signature — kneadState, contour, zoom,
            // draggedBlobId, hoveredBlobId, width, height, isPlaying,
            // playheadPosition, tempo. Each test names the two values its leg drives
            // between (ADR 0015); repaints are counted as background clears (one
            // `fillRect` per painted frame).
            //
            // Three further tests cover the ways the canvas bitmap can be cleared
            // behind the check's back, none of which moves any leg: a redundant
            // resize assignment, a fractional width that never settles, and a
            // restored 2D context.
            describe('dirty check (audit M-246)', () => {
                type RafHarness = {
                    stepFrame: () => void;
                    pendingFrames: () => number;
                };

                const installRafQueue = (): RafHarness => {
                    let queue: FrameRequestCallback[] = [];
                    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
                        queue.push(callback);
                        return queue.length;
                    });
                    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
                    cleanups.push(() => {
                        rafSpy.mockRestore();
                        cafSpy.mockRestore();
                    });
                    return {
                        stepFrame: () => {
                            const pending = queue;
                            queue = [];
                            for (const callback of pending) {
                                callback(0);
                            }
                        },
                        pendingFrames: () => queue.length,
                    };
                };

                type ContourPoint = {
                    time_ms: number;
                    frequency_hz: number;
                    confidence: number;
                    voiced: boolean;
                };

                type KneadSnapshot = {
                    activeClipId: string | null;
                    clips: Record<string, KneadClipState>;
                    contours: Record<string, { points: ContourPoint[]; sample_rate: number; hop_size: number }>;
                    isAnalyzing: boolean;
                    analysisProgress: number;
                };

                type MutableStores = {
                    knead: KneadSnapshot;
                    transport: typeof defaultTransportState;
                };

                // Both store reads are served from a mutable holder so a test can
                // swap one snapshot for a fresh object — the way a real store
                // publishes — and drive exactly one signature leg at a time.
                const installStores = (): MutableStores => {
                    const stores: MutableStores = {
                        knead: {
                            activeClipId: null,
                            clips: { 'clip-1': makeClipState([makeBlob()]) },
                            contours: {},
                            isAnalyzing: false,
                            analysisProgress: 0,
                        },
                        transport: { ...defaultTransportState },
                    };
                    vi.mocked(useStore).mockImplementation((_store: unknown, fallback: unknown) => {
                        if (fallback && typeof fallback === 'object' && 'isAnalyzing' in fallback) {
                            return stores.knead;
                        }
                        if (fallback && typeof fallback === 'object' && 'isPlaying' in fallback) {
                            return stores.transport;
                        }
                        return { keyRoot: 0, scaleName: 'major' };
                    });
                    return stores;
                };

                // Counts assignments to `canvas.width` / `canvas.height`. Per the
                // HTML spec an assignment resets the bitmap even when the value is
                // unchanged; jsdom does not model the bitmap, so the assignment is
                // the observable stand-in for the clear it would cause in a browser.
                const countBitmapWrites = (canvas: HTMLCanvasElement, property: 'width' | 'height'): (() => number) => {
                    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
                    const read = descriptor?.get;
                    const write = descriptor?.set;
                    if (!read || !write) {
                        throw new Error(`HTMLCanvasElement.prototype.${property} is not an accessor`);
                    }
                    let writes = 0;
                    Object.defineProperty(canvas, property, {
                        configurable: true,
                        get(): number {
                            const value: unknown = read.call(canvas);
                            return typeof value === 'number' ? value : 0;
                        },
                        set(value: number) {
                            writes += 1;
                            write.call(canvas, value);
                        },
                    });
                    return () => writes;
                };

                const getCanvas = (): HTMLCanvasElement => {
                    const canvas = document.querySelector('canvas');
                    expect(canvas).not.toBeNull();
                    return canvas!;
                };

                it('skips the repaint on idle frames but keeps the loop scheduled (needsRepaint true ↔ false)', () => {
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    const paintsAfterMount = fillRectSpy.mock.calls.length;
                    expect(paintsAfterMount).toBeGreaterThan(0);

                    raf.stepFrame();
                    raf.stepFrame();
                    raf.stepFrame();
                    raf.stepFrame();
                    raf.stepFrame();

                    // Nothing changed between frames: no further background clears.
                    expect(fillRectSpy.mock.calls.length).toBe(paintsAfterMount);
                    // The loop must stay alive to observe the next change.
                    expect(raf.pendingFrames()).toBe(1);
                });

                it('repaints exactly once after a zoom change, then goes idle again (zoom 1.0 ↔ 1.5)', () => {
                    // 400 px of parent at either zoom still clamps to the 800 px
                    // floor, so the canvas dimensions hold still and zoom is the only
                    // signature leg that moves. Without this the width leg carries the
                    // repaint and the zoom leg is never actually exercised.
                    stubContainerSize(400, 240);
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const canvas = getCanvas();
                    expect(canvas.width).toBe(800);
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    const sliders = screen.getAllByRole('slider');
                    fireEvent.change(sliders[sliders.length - 1]!, { target: { value: '150' } });
                    expect(canvas.width).toBe(800);
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    raf.stepFrame();
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints when the transport playhead moves (playheadPosition 0 ↔ 96)', () => {
                    const clipState = makeClipState([makeBlob()]);
                    let playheadPosition = 0;
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
                            return { ...defaultTransportState, isPlaying: true, playheadPosition };
                        }
                        return { keyRoot: 0, scaleName: 'major' };
                    });
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    const { rerender } = render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    playheadPosition = 96;
                    rerender(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();

                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints and draws the edit handles when a blob is hovered (hoveredBlobId null ↔ blob-1)', () => {
                    // Pin the container size so the blob row centre is deterministic
                    // (240 px tall → the single blob sits at y = 120) regardless of
                    // what earlier tests did to the prototype descriptors.
                    stubContainerSize(800, 240);
                    installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    // `arc` is reached only by the hover/drag handle block, so it
                    // reports whether hover actually got through to the draw — the
                    // loop's closure used to capture `hoveredBlobId` at mount and
                    // freeze it at null, so the handles never appeared.
                    const arcSpy = vi.spyOn(ctx, 'arc');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const paintsBefore = fillRectSpy.mock.calls.length;
                    expect(arcSpy).not.toHaveBeenCalled();

                    const canvas = getCanvas();
                    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 120 });
                    // The hover hit itself must have registered (lower centre → move).
                    expect(canvas.style.cursor).toBe('move');
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                    expect(arcSpy).toHaveBeenCalled();

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints when a blob drag begins (draggedBlobId null ↔ blob-1)', () => {
                    stubContainerSize(800, 240);
                    installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const canvas = getCanvas();

                    // Settle the hover repaint first, so the pointer-down leaves
                    // the drag as the only signature leg that moves.
                    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 120 });
                    raf.stepFrame();
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 90, clientY: 120 });
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints when the clip blobs change (pitchCenterCents 6000 ↔ 6300)', () => {
                    const stores = installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    const { rerender } = render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    stores.knead = {
                        ...stores.knead,
                        clips: { 'clip-1': makeClipState([makeBlob({ pitchCenterCents: 6300 })]) },
                    };
                    rerender(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints when the raw pitch contour arrives (contour absent ↔ one voiced point)', () => {
                    const stores = installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    const { rerender } = render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    // The clip state object is carried over untouched, so the
                    // contour is the only leg that moves.
                    stores.knead = {
                        ...stores.knead,
                        contours: {
                            'clip-1': {
                                points: [{ time_ms: 100, frequency_hz: 440, confidence: 0.9, voiced: true }],
                                sample_rate: 48000,
                                hop_size: 256,
                            },
                        },
                    };
                    rerender(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints when the transport starts (isPlaying false ↔ true)', () => {
                    const stores = installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    const { rerender } = render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    stores.transport = { ...stores.transport, isPlaying: true };
                    rerender(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints when the tempo changes under a parked playhead (tempo 120 ↔ 140)', () => {
                    const stores = installStores();
                    // The playhead x is playheadPosition * 60 / tempo * pxPerSec, so
                    // tempo only moves pixels while a playhead is actually drawn.
                    stores.transport = { ...stores.transport, isPlaying: true, playheadPosition: 4 };
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    const { rerender } = render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const paintsBefore = fillRectSpy.mock.calls.length;
                    expect(stores.transport.tempo).toBe(120);

                    stores.transport = { ...stores.transport, tempo: 140 };
                    rerender(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints when a window resize widens the canvas (width 800 ↔ 1200)', () => {
                    stubContainerSize(600, 240);
                    installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const canvas = getCanvas();
                    // 600 px parent at zoom 1 clamps up to the 800 px floor.
                    expect(canvas.width).toBe(800);
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    // A resize triggers no React render at all — the loop can only
                    // learn about the new bitmap by reading the canvas itself.
                    setContainerSize(1200, 240);
                    fireEvent(window, new Event('resize'));
                    expect(canvas.width).toBe(1200);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints when a window resize changes the canvas height (height 240 ↔ 320)', () => {
                    stubContainerSize(600, 240);
                    installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const canvas = getCanvas();
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    // Width still clamps to 800, so height is the only leg moving.
                    setContainerSize(600, 320);
                    fireEvent(window, new Event('resize'));
                    expect(canvas.width).toBe(800);
                    expect(canvas.height).toBe(320);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('repaints after the 2D context is restored (contextrestored: blank bitmap ↔ redrawn)', () => {
                    stubContainerSize(800, 240);
                    installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const canvas = getCanvas();
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    // The UA restores a lost 2D context with a cleared bitmap. No
                    // signature leg moves, so only an explicit invalidation can get
                    // the picture back — otherwise the editor stays blank until some
                    // unrelated input happens to change.
                    canvas.dispatchEvent(new Event('contextrestored'));

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);

                    // And it must settle again rather than repaint forever.
                    raf.stepFrame();
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore + 1);
                });

                it('a fractional canvas width still settles, so resizes stop resetting the bitmap', () => {
                    // 1005 px at zoom 1.5 is 1507.5. `canvas.width` is an unsigned
                    // long and truncates to 1507, so an un-floored comparison stays
                    // permanently unequal and every single resize event re-assigns —
                    // resetting the bitmap each time, which is exactly the blank
                    // editor this dirty check exists to avoid. Zoom steps in 0.1 on
                    // the shipped slider, so fractional widths are reachable.
                    stubContainerSize(1005, 240);
                    installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const canvas = getCanvas();

                    const sliders = screen.getAllByRole('slider');
                    fireEvent.change(sliders[sliders.length - 1]!, { target: { value: '150' } });
                    expect(canvas.width).toBe(1507);
                    raf.stepFrame();

                    const widthWrites = countBitmapWrites(canvas, 'width');
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    fireEvent(window, new Event('resize'));
                    fireEvent(window, new Event('resize'));

                    expect(widthWrites()).toBe(0);
                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore);
                });

                it('a resize that changes no dimension leaves the bitmap intact (800x240 ↔ 800x240)', () => {
                    stubContainerSize(600, 240);
                    installStores();
                    const ctx = make2dContext();
                    spyOnGetContext(ctx);
                    const fillRectSpy = vi.spyOn(ctx, 'fillRect');
                    const raf = installRafQueue();

                    render(<KneadEditor {...defaultProps} />);
                    raf.stepFrame();
                    const canvas = getCanvas();
                    const widthWrites = countBitmapWrites(canvas, 'width');
                    const heightWrites = countBitmapWrites(canvas, 'height');
                    const paintsBefore = fillRectSpy.mock.calls.length;

                    // A narrower parent that still clamps to the same 800 px width,
                    // at the same height. Nothing the dirty check compares moves, so
                    // nothing may reset the bitmap either — a redundant assignment
                    // would blank the canvas with no repaint coming to restore it.
                    setContainerSize(500, 240);
                    fireEvent(window, new Event('resize'));

                    expect(widthWrites()).toBe(0);
                    expect(heightWrites()).toBe(0);

                    raf.stepFrame();
                    expect(fillRectSpy.mock.calls.length).toBe(paintsBefore);
                });
            });
        });
    });
});
