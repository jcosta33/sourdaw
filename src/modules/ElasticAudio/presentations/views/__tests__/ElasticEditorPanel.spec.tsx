import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences, resetPreferences } from '#/modules/Preferences/useCases';

type TrackStoreSubscribe = (typeof import('#/modules/Arrangement/stores'))['trackStore']['subscribe'];

const mocks = vi.hoisted(() => {
    const waveformPeaks = new Map<string, Float32Array>();
    const trackStoreValue: {
        tracks: { id: string; clips: { id: string; type: string; audioBufferId: string | undefined }[] }[];
        selectedTrackId: string;
    } = {
        tracks: [
            {
                id: 't1',
                clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf-1' }],
            },
        ],
        selectedTrackId: 't1',
    };
    const timelineEditingValue: { snapValue: number } = {
        snapValue: 0.25,
    };
    const clipSelectionValue: { selectedClipId: string | null; selectedClipIds: string[]; marqueeSelection: null } = {
        selectedClipId: 'c1',
        selectedClipIds: [],
        marqueeSelection: null,
    };
    const elasticStoreValue: {
        openClipId: string | null;
        tool: 'select';
        selectedMarkerIds: unknown[];
        detected: boolean;
    } = {
        openClipId: 'c1',
        tool: 'select' as const,
        selectedMarkerIds: [],
        detected: true,
    };
    return {
        setElasticTool: vi.fn(),
        setElasticSensitivity: vi.fn().mockResolvedValue(undefined),
        detect: vi.fn<(clipId: string, sensitivity: number) => Promise<boolean>>().mockResolvedValue(true),
        cancel: vi.fn(),
        selectElasticMarkers: vi.fn(),
        quantizeTransients: vi.fn(),
        addManualMarker: vi.fn(),
        removeMarker: vi.fn(),
        toggleMarkerLock: vi.fn(),
        setStretchMode: vi.fn(),
        updateWarpMarkerBeat: vi.fn(),
        commitWarpMarkerBeatDrag: vi.fn(),
        setDefaultAlgorithm: vi.fn(),
        background: '#151515',
        waveformPeaks,
        getWaveformPeaks: vi.fn((...args: unknown[]) => {
            const key = `${String(args[0])}:${String(args[1])}`;
            let peaks = waveformPeaks.get(key);
            if (!peaks) {
                peaks = new Float32Array(Number(args[1])).fill(0.3);
                waveformPeaks.set(key, peaks);
            }
            return peaks;
        }),
        trackStoreValue,
        timelineEditingValue,
        clipSelectionValue,
        elasticStoreValue,
        warpStates: new Map<
            string,
            {
                enabled: boolean;
                markers: Array<{
                    id: string;
                    originalBeat: number;
                    warpedBeat: number;
                    origin?: 'user' | 'transient-auto' | 'grid-snap';
                    confidence?: number;
                    locked?: boolean;
                }>;
                stretchMode: 'repitch' | 'phase-vocoder' | 'wsola';
                originalTempo: number | null;
            }
        >([
            [
                'c1',
                {
                    enabled: true,
                    markers: [
                        { id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'transient-auto', confidence: 0.9 },
                        { id: 'm2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
                    ],
                    stretchMode: 'phase-vocoder' as const,
                    originalTempo: null,
                },
            ],
        ]),
    };
});

vi.mock('#/infra/store/useStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/store/useStore')>();
    return {
        useStore: (store: unknown, fallback?: unknown) => {
            if (store === preferencesStore) {
                return actual.useStore(preferencesStore, defaultPreferences);
            }
            const marker = (store as { __kind?: string }).__kind;
            if (marker === 'elastic') {
                return mocks.elasticStoreValue;
            }
            if (marker === 'track') {
                return mocks.trackStoreValue;
            }
            if (marker === 'timeline-editing') {
                return mocks.timelineEditingValue;
            }
            if (marker === 'clip-selection') {
                return mocks.clipSelectionValue;
            }
            if (marker === 'warp-states') {
                return { states: Object.fromEntries(mocks.warpStates) };
            }
            if (marker === 'warp') {
                return { clipSettings: new Map(), defaultAlgorithm: 'repitch', globalPitchShift: 0 };
            }
            return fallback ?? null;
        },
    };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        clipSelectionStore: { __kind: 'clip-selection' },
        timelineEditingStore: { __kind: 'timeline-editing' },
        defaultTimelineEditingState: { snapValue: 1 },
        trackStore: {
            __kind: 'track',
            subscribe: vi.fn<TrackStoreSubscribe>((_callback) => () => {}),
        },
        defaultTrackState: { tracks: [], selectedTrackId: null },
        warpStateStore: { __kind: 'warp-states' },
        warpStates: mocks.warpStates,
        getWarpState: (clipId: string) =>
            mocks.warpStates.get(clipId) ?? {
                enabled: false,
                markers: [],
                stretchMode: 'phase-vocoder',
                originalTempo: null,
            },
    };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        setStretchMode: (...args: unknown[]) => {
            mocks.setStretchMode(...args);
        },
        updateWarpMarkerBeat: (...args: unknown[]) => {
            mocks.updateWarpMarkerBeat(...args);
        },
        commitWarpMarkerBeatDrag: (...args: unknown[]) => {
            mocks.commitWarpMarkerBeatDrag(...args);
        },
    };
});

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: () => mocks.background,
}));

vi.mock('../../../stores/elasticAudio', () => ({
    elasticAudioStore: {
        __kind: 'elastic',
        value: mocks.elasticStoreValue,
        set: (v: unknown) => {
            Object.assign(mocks.elasticStoreValue, v as object);
        },
    },
    defaultElasticAudioState: {
        openClipId: null,
        tool: 'select',
        selectedMarkerIds: [],
        detected: false,
    },
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        getWaveformPeaks: (...args: unknown[]) => mocks.getWaveformPeaks(...args),
    },
}));

vi.mock('../../../stores/audioWarp', () => ({
    audioWarpStore: { __kind: 'warp' },
    WARP_ALGORITHMS: ['repitch', 'phase-vocoder', 'wsola'],
}));

vi.mock('../../../useCases/audioWarping/getAlgorithmInfo', () => ({
    getAlgorithmInfo: (id: string) => ({
        name: `algo:${id}`,
        available: id === 'repitch',
        description: '',
    }),
}));

vi.mock('../../../useCases/audioWarping/setDefaultAlgorithm', () => ({
    setDefaultAlgorithm: (...args: unknown[]) => mocks.setDefaultAlgorithm(...args),
}));

vi.mock('../../../useCases/elasticAudio/addManualMarker', () => ({
    addManualMarker: (...args: unknown[]) => mocks.addManualMarker(...args),
}));

vi.mock('../../../useCases/elasticAudio/detectElasticEditorTransients', () => ({
    detectElasticEditorTransients: mocks.detect,
}));
vi.mock('../../../useCases/elasticAudio/cancelTransientDetection', () => ({ cancelTransientDetection: mocks.cancel }));

vi.mock('../../../useCases/quantizeTransients', () => ({
    quantizeTransients: (...args: unknown[]) => mocks.quantizeTransients(...args),
}));

vi.mock('../../../useCases/elasticAudio/removeMarker', () => ({
    removeMarker: (...args: unknown[]) => mocks.removeMarker(...args),
}));

vi.mock('../../../useCases/elasticAudio/setElasticSensitivity', () => ({
    setElasticSensitivity: (...args: unknown[]) => mocks.setElasticSensitivity(...args),
}));

vi.mock('../../../useCases/elasticAudio/setElasticTool', () => ({
    setElasticTool: (...args: unknown[]) => mocks.setElasticTool(...args),
}));

vi.mock('../../../useCases/elasticAudio/selectElasticMarkers', () => ({
    selectElasticMarkers: (...args: unknown[]) => mocks.selectElasticMarkers(...args),
}));

vi.mock('../../../useCases/elasticAudio/toggleMarkerLock', () => ({
    toggleMarkerLock: (...args: unknown[]) => mocks.toggleMarkerLock(...args),
}));

import { ElasticEditorPanel } from '../ElasticEditorPanel';

describe('ElasticEditorPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.waveformPeaks.clear();
        mocks.background = '#151515';
        preferencesStore.trySet(defaultPreferences);
        mocks.trackStoreValue = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf-1' }] }],
            selectedTrackId: 't1',
        };
        mocks.timelineEditingValue = { snapValue: 0.25 };
        mocks.clipSelectionValue = { selectedClipId: 'c1', selectedClipIds: [], marqueeSelection: null };
        mocks.elasticStoreValue = {
            openClipId: 'c1',
            tool: 'select',
            selectedMarkerIds: [],
            detected: true,
        };
        mocks.warpStates.set('c1', {
            enabled: true,
            markers: [
                { id: 'm1', originalBeat: 1, warpedBeat: 1, origin: 'transient-auto', confidence: 0.9 },
                { id: 'm2', originalBeat: 2, warpedBeat: 2, origin: 'user' },
            ],
            stretchMode: 'phase-vocoder',
            originalTempo: null,
        });
    });

    afterEach(() => {
        preferencesStore.trySet(defaultPreferences);
        vi.clearAllMocks();
    });

    it('renders the waveform canvas and marker count for the open clip', () => {
        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-waveform-canvas')).toBeInTheDocument();
        expect(screen.getByTestId('elastic-detail-strip')).toHaveTextContent('1 transient, 1 user, 0 locked');
    });

    describe('waveform drawing', () => {
        // The panel paints in an animation frame; each case runs the pending frame explicitly.
        const frames = new Map<number, FrameRequestCallback>();
        let lastFrame = 0;

        function flushFrame(): void {
            const pending = [...frames.values()];
            frames.clear();
            for (const callback of pending) {
                callback(performance.now());
            }
        }

        beforeEach(() => {
            frames.clear();
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
                lastFrame += 1;
                frames.set(lastFrame, callback);
                return lastFrame;
            });
            vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
                frames.delete(handle);
            });
        });

        function publishEquivalentSnapshot(): void {
            const state = mocks.warpStates.get('c1');
            if (!state) {
                throw new Error('Missing fixture warp state');
            }
            mocks.warpStates.set('c1', structuredClone(state));
        }

        function observeDrawing() {
            const context = document.createElement('canvas').getContext('2d');
            if (!context) {
                throw new Error('Missing fixture canvas context');
            }
            const strokeColors: string[] = [];
            const fillColors: string[] = [];
            vi.spyOn(context, 'stroke').mockImplementation(() => {
                if (typeof context.strokeStyle !== 'string') {
                    throw new TypeError('Expected a string stroke color');
                }
                strokeColors.push(context.strokeStyle);
            });
            const fill = vi.spyOn(context, 'fillRect').mockImplementation(() => {
                if (typeof context.fillStyle !== 'string') {
                    throw new TypeError('Expected a string fill color');
                }
                fillColors.push(context.fillStyle);
            });
            return { context, fill, line: vi.spyOn(context, 'lineTo'), strokeColors, fillColors };
        }

        afterEach(() => {
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        });

        it('paints in the next frame, coalesces changes to the latest arguments and cancels on unmount', () => {
            const drawing = observeDrawing();
            const view = render(<ElasticEditorPanel />);
            expect(drawing.fill).not.toHaveBeenCalled();
            flushFrame();
            expect(drawing.fill).toHaveBeenCalledWith(0, 0, 2560, 120);
            const state = mocks.warpStates.get('c1');
            const marker = state?.markers[0];
            if (!state || !marker) {
                throw new Error('Missing fixture marker');
            }
            drawing.fill.mockClear();
            mocks.warpStates.set('c1', { ...state, markers: [{ ...marker, originalBeat: 80 }] });
            view.rerender(<ElasticEditorPanel />);
            mocks.warpStates.set('c1', { ...state, markers: [{ ...marker, originalBeat: 100 }] });
            view.rerender(<ElasticEditorPanel />);
            expect(frames.size).toBe(1);
            expect(drawing.fill).not.toHaveBeenCalled();
            flushFrame();
            // contentBeats = 100 + 8 at 40 px per beat; the superseded 80-beat width never paints.
            expect(drawing.fill).toHaveBeenCalledWith(0, 0, 4320, 120);
            expect(drawing.fill).not.toHaveBeenCalledWith(0, 0, 3520, 120);
            drawing.fill.mockClear();
            mocks.warpStates.set('c1', { ...state, markers: [{ ...marker, originalBeat: 120 }] });
            view.rerender(<ElasticEditorPanel />);
            view.unmount();
            flushFrame();
            expect(drawing.fill).not.toHaveBeenCalled();
        });

        it('does not clear or resubmit pixels for a distinct authoritative snapshot with equal visual inputs', () => {
            const drawing = observeDrawing();
            const view = render(<ElasticEditorPanel />);
            flushFrame();
            const canvas = screen.getByTestId<HTMLCanvasElement>('elastic-waveform-canvas');
            expect(drawing.fill).toHaveBeenCalledWith(0, 0, 2560, 120);
            expect(drawing.line).toHaveBeenCalledWith(40, 120);
            const fills = drawing.fill.mock.calls.length;
            const lines = drawing.line.mock.calls.length;
            const backingWidth = vi.spyOn(canvas, 'width', 'set');
            const backingHeight = vi.spyOn(canvas, 'height', 'set');
            publishEquivalentSnapshot();
            view.rerender(<ElasticEditorPanel />);
            flushFrame();
            expect(drawing.fill).toHaveBeenCalledTimes(fills);
            expect(drawing.line).toHaveBeenCalledTimes(lines);
            expect(backingWidth).not.toHaveBeenCalled();
            expect(backingHeight).not.toHaveBeenCalled();
        });

        it.each(['warpedBeat', 'originalBeat', 'origin', 'confidence', 'locked'] as const)(
            'redraws changed marker %s even when the marker array identity is retained',
            (field) => {
                const drawing = observeDrawing();
                const view = render(<ElasticEditorPanel />);
                flushFrame();
                drawing.fill.mockClear();
                drawing.line.mockClear();
                const state = mocks.warpStates.get('c1');
                const marker = state?.markers[0];
                if (!state || !marker) {
                    throw new Error('Missing fixture marker');
                }
                if (field === 'origin') {
                    marker.origin = 'grid-snap';
                } else if (field === 'locked') {
                    marker.locked = true;
                } else {
                    marker[field] = field === 'confidence' ? 0.2 : 80;
                }
                mocks.warpStates.set('c1', {
                    enabled: state.enabled,
                    markers: state.markers,
                    stretchMode: state.stretchMode,
                    originalTempo: state.originalTempo,
                });
                view.rerender(<ElasticEditorPanel />);
                flushFrame();
                expect(drawing.fill).toHaveBeenCalledWith(
                    0,
                    0,
                    field === 'originalBeat' || field === 'warpedBeat' ? 3520 : 2560,
                    120
                );
                if (field === 'warpedBeat') {
                    expect(drawing.line).toHaveBeenCalledWith(3200, 120);
                } else if (field === 'locked') {
                    expect(drawing.fill).toHaveBeenCalledWith(38, 10, 4, 4);
                } else if (field === 'origin') {
                    expect(drawing.strokeColors).toContain('rgba(120, 190, 130, 0.85)');
                } else if (field === 'confidence') {
                    expect(drawing.strokeColors).toContain('rgba(99, 160, 214, 0.46)');
                }
            }
        );

        it.each(['source', 'peaks', 'width', 'height', 'dpr', 'theme', 'zoom', 'scroll'])(
            'redraws after changing %s',
            (input) => {
                const drawing = observeDrawing();
                const view = render(<ElasticEditorPanel />);
                flushFrame();
                const canvas = screen.getByTestId<HTMLCanvasElement>('elastic-waveform-canvas');
                const container = canvas.parentElement;
                if (!container) {
                    throw new Error('Missing waveform container');
                }
                drawing.fill.mockClear();
                if (input === 'source') {
                    mocks.trackStoreValue.tracks[0]!.clips[0]!.audioBufferId = 'buf-2';
                } else if (input === 'peaks') {
                    mocks.waveformPeaks.set('buf-1:2560', new Float32Array(2560).fill(0.8));
                } else if (input === 'width' || input === 'height') {
                    Object.defineProperty(container, input === 'width' ? 'clientWidth' : 'clientHeight', {
                        configurable: true,
                        value: input === 'width' ? 3000 : 180,
                    });
                } else if (input === 'dpr') {
                    vi.stubGlobal('devicePixelRatio', 2);
                } else if (input === 'theme') {
                    mocks.background = '#202020';
                } else if (input === 'zoom') {
                    fireEvent.keyDown(screen.getByRole('slider', { name: 'Waveform zoom' }), { key: 'ArrowRight' });
                } else {
                    container.scrollLeft = 40;
                    fireEvent.scroll(container);
                }
                publishEquivalentSnapshot();
                view.rerender(<ElasticEditorPanel />);
                flushFrame();
                expect(drawing.fill).toHaveBeenCalled();
                if (input === 'source') {
                    expect(mocks.getWaveformPeaks).toHaveBeenLastCalledWith('buf-2', 2560);
                } else if (input === 'peaks') {
                    expect(drawing.line).toHaveBeenCalledWith(0, expect.closeTo(16.8, 4));
                } else if (input === 'width' || input === 'height') {
                    expect(drawing.fill).toHaveBeenCalledWith(
                        0,
                        0,
                        input === 'width' ? 3000 : 2560,
                        input === 'height' ? 180 : 120
                    );
                } else if (input === 'dpr') {
                    expect(canvas.width).toBe(5120);
                    expect(canvas.height).toBe(240);
                } else if (input === 'theme') {
                    expect(drawing.fillColors).toContain('#202020');
                } else if (input === 'zoom') {
                    expect(canvas.width).toBe(3200);
                }
            }
        );

        it('redraws after the canvas or its context is replaced', () => {
            const drawing = observeDrawing();
            const view = render(<ElasticEditorPanel />);
            flushFrame();
            const originalCanvas = screen.getByTestId<HTMLCanvasElement>('elastic-waveform-canvas');
            const replacementContext = { ...drawing.context, fillRect: vi.fn() };
            Object.defineProperty(originalCanvas, 'getContext', {
                configurable: true,
                value: (kind: string) => (kind === '2d' ? replacementContext : null),
            });
            publishEquivalentSnapshot();
            view.rerender(<ElasticEditorPanel />);
            flushFrame();
            expect(replacementContext.fillRect).toHaveBeenCalledWith(0, 0, 2560, 120);

            mocks.elasticStoreValue = { ...mocks.elasticStoreValue, openClipId: 'missing' };
            view.rerender(<ElasticEditorPanel />);
            flushFrame();
            drawing.fill.mockClear();
            mocks.elasticStoreValue = { ...mocks.elasticStoreValue, openClipId: 'c1' };
            view.rerender(<ElasticEditorPanel />);
            flushFrame();
            expect(screen.getByTestId('elastic-waveform-canvas')).not.toBe(originalCanvas);
            expect(drawing.fill).toHaveBeenCalledWith(0, 0, 2560, 120);
            drawing.fill.mockClear();
            fireEvent(originalCanvas, new Event('contextrestored'));
            flushFrame();
            expect(drawing.fill).not.toHaveBeenCalled();
        });

        it('updates the visible marker window on scroll and container resize without changing content width', () => {
            const state = mocks.warpStates.get('c1');
            if (!state) {
                throw new Error('Missing fixture warp state');
            }
            state.markers = Array.from({ length: 201 }, (_, index) => ({
                id: `marker-${index}`,
                originalBeat: index * 2,
                warpedBeat: index * 2,
            }));
            const drawing = observeDrawing();
            const view = render(<ElasticEditorPanel />);
            flushFrame();
            const canvas = screen.getByTestId<HTMLCanvasElement>('elastic-waveform-canvas');
            const container = canvas.parentElement;
            if (!container) {
                throw new Error('Missing waveform container');
            }
            Object.defineProperty(container, 'clientWidth', { configurable: true, value: 100 });
            publishEquivalentSnapshot();
            drawing.line.mockClear();
            view.rerender(<ElasticEditorPanel />);
            flushFrame();
            expect(drawing.line).toHaveBeenCalledWith(5, 0);
            expect(drawing.line).not.toHaveBeenCalledWith(8005, 0);

            drawing.line.mockClear();
            container.scrollLeft = 8000;
            fireEvent.scroll(container);
            flushFrame();
            expect(drawing.line).toHaveBeenCalledWith(8005, 0);
            expect(drawing.line).not.toHaveBeenCalledWith(5, 0);
            expect(drawing.line).not.toHaveBeenCalledWith(8245, 0);

            Object.defineProperty(container, 'clientWidth', { configurable: true, value: 300 });
            publishEquivalentSnapshot();
            drawing.line.mockClear();
            view.rerender(<ElasticEditorPanel />);
            flushFrame();
            expect(canvas.width).toBe(16320);
            expect(drawing.line).toHaveBeenCalledWith(8245, 0);
        });

        it.each(['width', 'height', 'context reset', 'context restored'])(
            'restores pixels after an external %s even when visual inputs are unchanged',
            (reset) => {
                const drawing = observeDrawing();
                const view = render(<ElasticEditorPanel />);
                flushFrame();
                const canvas = screen.getByTestId<HTMLCanvasElement>('elastic-waveform-canvas');
                drawing.fill.mockClear();
                if (reset === 'width' || reset === 'height') {
                    const size = canvas[reset];
                    canvas[reset] = size;
                }
                if (reset !== 'context restored') {
                    // jsdom does not implement the default drawing-state reset of native Canvas2D.
                    drawing.context.strokeStyle = '#000000';
                }
                if (reset === 'context restored') {
                    fireEvent(canvas, new Event('contextlost'));
                    fireEvent(canvas, new Event('contextrestored'));
                    expect(drawing.fill).toHaveBeenCalledWith(0, 0, 2560, 120);
                }
                publishEquivalentSnapshot();
                view.rerender(<ElasticEditorPanel />);
                flushFrame();
                expect(drawing.fill).toHaveBeenCalledWith(0, 0, 2560, 120);
                expect(drawing.context.strokeStyle).not.toBe('#000000');
            }
        );

        it('truncates fractional backing dimensions once and retains them during a material marker redraw', () => {
            const drawing = observeDrawing();
            mocks.warpStates.get('c1')!.markers[0]!.originalBeat = 80.123;
            const view = render(<ElasticEditorPanel />);
            flushFrame();
            const canvas = screen.getByTestId<HTMLCanvasElement>('elastic-waveform-canvas');
            expect(canvas.width).toBe(3524);
            const backingWidth = vi.spyOn(canvas, 'width', 'set');
            const backingHeight = vi.spyOn(canvas, 'height', 'set');
            mocks.warpStates.get('c1')!.markers[0]!.locked = true;
            publishEquivalentSnapshot();
            drawing.fill.mockClear();
            view.rerender(<ElasticEditorPanel />);
            flushFrame();
            expect(drawing.fill).toHaveBeenCalledWith(38, 10, 4, 4);
            expect(backingWidth).not.toHaveBeenCalled();
            expect(backingHeight).not.toHaveBeenCalled();
        });
    });

    it('uses the selected audio target without requiring an explicitly opened editor', () => {
        mocks.elasticStoreValue.openClipId = null;
        render(<ElasticEditorPanel />);
        expect(screen.getByRole('slider', { name: 'Transient detection sensitivity' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Detect' }));
        expect(mocks.detect).toHaveBeenCalledWith('c1', 0.5);
        expect(mocks.elasticStoreValue.openClipId).toBeNull();
    });

    it.each(['missing', 'midi'])('does not fall through an explicitly opened %s target to selected audio', (id) => {
        if (id === 'midi') {
            mocks.trackStoreValue.tracks[0]?.clips.push({ id, type: 'midi', audioBufferId: undefined });
        }
        mocks.elasticStoreValue.openClipId = id;
        render(<ElasticEditorPanel />);
        expect(screen.getByText(/Select an audio clip/i)).toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: 'Transient detection sensitivity' })).not.toBeInTheDocument();
        expect(mocks.detect).not.toHaveBeenCalled();
    });

    it('hides the warp algorithm selector and surfaces no third-party engine while only repitch is available', () => {
        render(<ElasticEditorPanel />);
        expect(screen.queryByLabelText('Warp algorithm')).not.toBeInTheDocument();
        expect(screen.queryByText(/élastique|elastique|rubber\s*band/i)).not.toBeInTheDocument();
    });

    it('hides the stretch selector and offers no mode without an executor', () => {
        render(<ElasticEditorPanel />);

        // The toolbar itself renders — the Quantize control is right beside the
        // stretch selector, so its presence proves the strip is not simply absent.
        expect(screen.getByRole('button', { name: 'Quantize' })).toBeInTheDocument();

        expect(screen.queryByLabelText('Stretch mode')).not.toBeInTheDocument();
        // The selector renders from STRETCH_MODES alone: the canonical executor
        // labels, and never the pre-ADR 0024 names.
        for (const label of ['Repitch', 'Phase-vocoder', 'WSOLA', 'Complex', 'Texture', 'Beats']) {
            expect(screen.queryByRole('option', { name: label })).not.toBeInTheDocument();
        }
    });

    it('calls setElasticSensitivity when the sensitivity slider changes', () => {
        render(<ElasticEditorPanel />);
        const slider = screen.getByLabelText('Transient detection sensitivity');
        expect(slider).toBeInTheDocument();
        fireEvent.keyDown(slider, { key: 'ArrowRight' });
        expect(mocks.setElasticSensitivity).toHaveBeenCalled();
    });

    it('switches tool mode when a tool button is clicked', () => {
        render(<ElasticEditorPanel />);
        fireEvent.click(screen.getByTestId('elastic-tool-add-marker'));
        expect(mocks.setElasticTool).toHaveBeenCalledWith('add-marker');
        fireEvent.click(screen.getByTestId('elastic-tool-remove-marker'));
        expect(mocks.setElasticTool).toHaveBeenCalledWith('remove-marker');
        fireEvent.click(screen.getByTestId('elastic-tool-lock-marker'));
        expect(mocks.setElasticTool).toHaveBeenCalledWith('lock-marker');
    });

    it('shows completion only for the owning Detect receipt', async () => {
        render(<ElasticEditorPanel />);
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        expect(mocks.detect).toHaveBeenCalledWith('c1', 0.5);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Detection complete'));
    });

    it('keeps pending Detect incomplete, reports failure and permits a successful retry', async () => {
        let fail: ((error: Error) => void) | undefined;
        mocks.detect.mockImplementationOnce(
            () =>
                new Promise<boolean>((_resolve, reject) => {
                    fail = reject;
                })
        );
        render(<ElasticEditorPanel />);
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        expect(screen.getByRole('status')).toHaveTextContent('Detecting');
        await act(async () => fail?.(new Error('Worker failed')));
        expect(screen.getByRole('status')).toHaveTextContent('failed');
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Detection complete'));
    });

    it('revokes a pending request on unmount', async () => {
        let complete: (() => void) | undefined;
        mocks.detect.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    complete = () => resolve(false);
                })
        );
        const view = render(<ElasticEditorPanel />);
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        view.unmount();
        expect(mocks.cancel).toHaveBeenCalledWith('c1');
        await act(async () => complete?.());
    });

    it('clears a retired receipt while retaining a successor request status', async () => {
        const retired = Promise.withResolvers<boolean>();
        const successor = Promise.withResolvers<boolean>();
        mocks.detect.mockReturnValueOnce(retired.promise).mockReturnValueOnce(successor.promise);
        render(<ElasticEditorPanel />);
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        await act(async () => retired.resolve(false));
        expect(screen.getByRole('status')).toHaveTextContent('Detecting');
        await act(async () => successor.resolve(false));
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('uses the saved sensitivity for the first Detect on a newly opened clip', () => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
        mocks.trackStoreValue.tracks[0]?.clips.push({ id: 'c2', type: 'audio', audioBufferId: 'buf-2' });
        mocks.elasticStoreValue.openClipId = 'c2';

        render(<ElasticEditorPanel />);

        expect(screen.getByText('82')).toBeInTheDocument();
        expect(mocks.detect).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        expect(mocks.detect).toHaveBeenCalledWith('c2', 0.82);
    });

    it('reacts to Reset Preferences while the editor stays open', async () => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
        render(<ElasticEditorPanel />);
        expect(screen.getByText('82')).toBeInTheDocument();

        await act(async () => {
            resetPreferences();
        });

        expect(screen.getByText('50')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('elastic-detect-button'));
        expect(mocks.detect).toHaveBeenCalledWith('c1', 0.5);
    });

    it('selects an existing marker through the elastic selection use case', () => {
        render(<ElasticEditorPanel />);
        const canvas = screen.getByTestId('elastic-waveform-canvas');
        canvas.setPointerCapture = vi.fn();
        canvas.releasePointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, {
            clientX: 40,
            pointerId: 4,
        });

        expect(mocks.selectElasticMarkers).toHaveBeenCalledWith(['m1']);
        expect(mocks.addManualMarker).not.toHaveBeenCalled();
        expect(mocks.removeMarker).not.toHaveBeenCalled();
        expect(mocks.toggleMarkerLock).not.toHaveBeenCalled();
    });

    it('should update warpedBeat through the Arrangement use case during snapped marker drag', () => {
        render(<ElasticEditorPanel />);
        const canvas = screen.getByTestId('elastic-waveform-canvas');
        canvas.setPointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, {
            clientX: 40,
            pointerId: 4,
        });
        fireEvent.pointerMove(canvas, {
            clientX: 69,
            pointerId: 4,
            ctrlKey: true,
        });
        fireEvent.pointerUp(canvas, {
            pointerId: 4,
        });

        expect(mocks.updateWarpMarkerBeat).toHaveBeenCalledWith({
            clipId: 'c1',
            markerId: 'm1',
            field: 'warpedBeat',
            beat: 1.75,
        });
        expect(mocks.commitWarpMarkerBeatDrag).toHaveBeenCalledWith({
            clipId: 'c1',
            markerId: 'm1',
            beforeOriginalBeat: 1,
            beforeWarpedBeat: 1,
        });
    });

    it('should update originalBeat through the Arrangement use case during alt marker drag', () => {
        render(<ElasticEditorPanel />);
        const canvas = screen.getByTestId('elastic-waveform-canvas');
        canvas.setPointerCapture = vi.fn();
        canvas.releasePointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, {
            clientX: 40,
            pointerId: 4,
            altKey: true,
        });
        fireEvent.pointerMove(canvas, {
            clientX: 72,
            pointerId: 4,
            altKey: true,
        });
        fireEvent.pointerUp(canvas, {
            pointerId: 4,
        });

        expect(mocks.updateWarpMarkerBeat).toHaveBeenCalledWith({
            clipId: 'c1',
            markerId: 'm1',
            field: 'originalBeat',
            beat: 1.8,
        });
        expect(mocks.commitWarpMarkerBeatDrag).toHaveBeenCalledWith({
            clipId: 'c1',
            markerId: 'm1',
            beforeOriginalBeat: 1,
            beforeWarpedBeat: 1,
        });
    });

    it('should commit marker drag undo when pointer capture is canceled', () => {
        render(<ElasticEditorPanel />);
        const canvas = screen.getByTestId('elastic-waveform-canvas');
        canvas.setPointerCapture = vi.fn();

        fireEvent.pointerDown(canvas, {
            clientX: 40,
            pointerId: 4,
        });
        fireEvent.pointerMove(canvas, {
            clientX: 69,
            pointerId: 4,
        });
        fireEvent.pointerCancel(canvas, {
            pointerId: 4,
        });

        expect(mocks.commitWarpMarkerBeatDrag).toHaveBeenCalledWith({
            clipId: 'c1',
            markerId: 'm1',
            beforeOriginalBeat: 1,
            beforeWarpedBeat: 1,
        });
    });

    it('quantizes to the snap grid at the saved sensitivity on Quantize when markers exist and detection ran', () => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
        render(<ElasticEditorPanel />);
        const btn = screen.getByTestId('elastic-quantize-button');
        expect(btn).not.toBeDisabled();
        fireEvent.click(btn);
        expect(mocks.quantizeTransients).toHaveBeenCalledWith('c1', 0.25, 0.82);
    });

    it('quantizes to the snap grid from the G shortcut', () => {
        mocks.timelineEditingValue = { snapValue: 0.5 };
        render(<ElasticEditorPanel />);
        fireEvent.keyDown(window, { key: 'g' });
        expect(mocks.quantizeTransients).toHaveBeenCalledWith(
            'c1',
            0.5,
            defaultPreferences.elasticTransientSensitivity
        );
    });

    it('disables the Quantize button when detection has not run', () => {
        mocks.elasticStoreValue = {
            openClipId: 'c1',
            tool: 'select',
            selectedMarkerIds: [],
            detected: false,
        };
        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-quantize-button')).toBeDisabled();
    });

    it('shows an empty state when no audio clip is selected', () => {
        mocks.timelineEditingValue = { snapValue: 0.25 };
        mocks.clipSelectionValue = { selectedClipId: null, selectedClipIds: [], marqueeSelection: null };
        mocks.elasticStoreValue = {
            openClipId: null,
            tool: 'select',
            selectedMarkerIds: [],
            detected: false,
        };
        render(<ElasticEditorPanel />);
        expect(screen.getByText(/Select an audio clip/i)).toBeInTheDocument();

        // The placeholder returns before any warp toolbar renders, which is the
        // only reason the no-clip warp state is never read. Pin that: if the
        // early return is ever removed, this fails instead of silently
        // surfacing placeholder warp state.
        expect(screen.queryByTestId('elastic-quantize-button')).not.toBeInTheDocument();
        expect(screen.queryByTestId('elastic-waveform-canvas')).not.toBeInTheDocument();
    });

    it('shows an empty state when the selected clip is not audio', () => {
        mocks.trackStoreValue = {
            tracks: [{ id: 't1', clips: [{ id: 'cmidi', type: 'midi', audioBufferId: undefined }] }],
            selectedTrackId: 't1',
        };
        mocks.timelineEditingValue = { snapValue: 0.25 };
        mocks.clipSelectionValue = { selectedClipId: 'cmidi', selectedClipIds: [], marqueeSelection: null };
        mocks.elasticStoreValue = {
            openClipId: null,
            tool: 'select',
            selectedMarkerIds: [],
            detected: false,
        };
        render(<ElasticEditorPanel />);
        expect(screen.getByText(/Select an audio clip/i)).toBeInTheDocument();
    });
});
