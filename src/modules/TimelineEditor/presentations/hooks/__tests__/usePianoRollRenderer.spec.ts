import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { usePianoRollRenderer } from '../usePianoRollRenderer';

const mocks = vi.hoisted(() => {
    type Track = {
        id: string;
        kind: string;
        color: string;
        clips: Array<{ id: string; type: string; color: string; startBeat?: number; endBeat?: number }>;
    };
    return {
        midiState: { notesByClipId: {} },
        trackState: { tracks: [] as Track[] },
    };
});

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiState;
        },
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackState;
        },
    },
}));

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn((_token: string, fallback: string) => fallback),
}));

type RendererDeps = Parameters<typeof usePianoRollRenderer>[0];

// ── Geometry ─────────────────────────────────────────────────────────────
// chromatic + unfolded → 60 rows, pitches 83..24 top-to-bottom.
// The canvas covers the viewport, so its width comes from the scroll
// container: clientWidth 400 - PITCH_RAIL_WIDTH(40) = 360 visible pixels.
// height = 60 * 16 + RULER(22) = 982. At scrollLeft 0 the drawn slice starts
// at beat 0, so note x = startBeat * 10, y = (83 - pitch) * 16.
const BEAT_W = 10;
const VIEWPORT_W = 360;
const PITCH_RAIL_W = 40;

const rowY = (pitch: number): number => (83 - pitch) * 16;

/**
 * Stand-in for the `overflow-auto` scroll container. Only `clientWidth` and
 * `scrollLeft` are read, and they are exactly what decides which slice of the
 * arrangement the canvas covers — a test that leaves them at jsdom's zeroes
 * would be asserting against a viewport that does not exist.
 */
const scrollContainer = (scrollLeft = 0, clientWidth = VIEWPORT_W + PITCH_RAIL_W): { current: HTMLElement } => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(element, 'scrollLeft', { value: scrollLeft, writable: true, configurable: true });
    return { current: element };
};

// rAF under manual control: the renderer re-queues a tick per frame.
let rafQueue: FrameRequestCallback[] = [];
const cancelRaf = vi.fn();

const runTick = (): void => {
    const callbacks = rafQueue;
    rafQueue = [];
    act(() => {
        for (const callback of callbacks) {
            callback(0);
        }
    });
};

class OffscreenCanvasStub {
    width: number;
    height: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    getContext(): CanvasRenderingContext2D | null {
        // The jsdom test setup routes every '2d' request to a shared stub, so
        // the offscreen grid shares the recorded context with the main canvas.
        return document.createElement('canvas').getContext('2d');
    }
}

const buildDeps = (overrides: Partial<RendererDeps> = {}): RendererDeps => ({
    canvasRef: { current: document.createElement('canvas') },
    scrollRef: scrollContainer(),
    notes: [],
    clipId: 'clip-1',
    trackId: 'track-1',
    beatWidth: BEAT_W,
    gridSnap: 1,
    scaleType: 'chromatic',
    scaleRoot: 0,
    isFolded: false,
    selectedNoteIds: new Set<string>(),
    stepInput: false,
    stepBeat: 0,
    stepPitch: 60,
    showGhostNotes: false,
    drawPreviewRef: { current: null },
    rubberBandRef: { current: null },
    dragPreviewRef: { current: null },
    ...overrides,
});

describe('usePianoRollRenderer', () => {
    // The shared 2d context stub from setupTests — same object for every canvas.
    const ctx = document.createElement('canvas').getContext('2d')!;

    beforeEach(() => {
        vi.clearAllMocks();
        rafQueue = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            rafQueue.push(callback);
            return rafQueue.length;
        });
        vi.stubGlobal('cancelAnimationFrame', cancelRaf);
        vi.stubGlobal('OffscreenCanvas', OffscreenCanvasStub);
        mocks.midiState = { notesByClipId: {} };
        mocks.trackState = { tracks: [] };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sizes the canvas backing store to the viewport on the first tick', () => {
        const deps = buildDeps();
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        const canvas = deps.canvasRef.current!;
        expect(canvas.width).toBe(VIEWPORT_W);
        expect(canvas.height).toBe(982);
        expect(canvas.style.width).toBe(`${VIEWPORT_W}px`);
        expect(canvas.style.height).toBe('982px');
    });

    // Issue #2299. A backing store sized to the whole arrangement made the
    // reachable beat count inversely proportional to zoom: a canvas dimension
    // is finite, so `beats * beatWidth * devicePixelRatio` had to fit inside
    // it, and every attempt to bound that product truncated one of the two.
    // The backing store must therefore not grow with content at all — a clip
    // 100x longer than the viewport gets the same backing store as an empty
    // one, and the extra beats live in CSS layout instead (PianoRoll.tsx).
    it('keeps the backing store at the viewport size no matter how long the clip is', () => {
        const emptyDeps = buildDeps();
        renderHook(() => usePianoRollRenderer(emptyDeps));
        runTick();
        const emptyWidth = emptyDeps.canvasRef.current!.width;

        mocks.trackState = {
            tracks: [
                {
                    id: 'track-1',
                    kind: 'midi',
                    color: 'oklch(0.5 0.1 200)',
                    clips: [{ id: 'clip-1', type: 'midi', color: '', startBeat: 0, endBeat: 4000 }],
                },
            ],
        };
        mocks.midiState = {
            notesByClipId: { 'clip-1': [{ id: 'n1', pitch: 60, startBeat: 3990, duration: 4, velocity: 100 }] },
        };
        const longDeps = buildDeps();
        renderHook(() => usePianoRollRenderer(longDeps));
        runTick();

        expect(longDeps.canvasRef.current!.width).toBe(VIEWPORT_W);
        expect(longDeps.canvasRef.current!.width).toBe(emptyWidth);
    });

    // The cached grid and the dynamic layers have to move by the same amount
    // or the picture tears apart the moment the user scrolls, so both origins
    // are asserted together against one scroll offset. The layers themselves
    // keep drawing in absolute content coordinates — the shift lives in the
    // context transform and in the blit position, nowhere else.
    it('puts the grid blit and the dynamic layers on the same scrolled origin', () => {
        const setTransform = vi.spyOn(ctx, 'setTransform');
        const drawImage = vi.spyOn(ctx, 'drawImage');
        const roundRect = vi.spyOn(ctx, 'roundRect');
        mocks.midiState = {
            notesByClipId: {
                'clip-1': [{ id: 'n1', pitch: 60, startBeat: 35, duration: 2, velocity: 127 }],
            },
        };
        const deps = buildDeps({ scrollRef: scrollContainer(300) });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        // Beat 35 at beatWidth 10 → content x 350, +1 for the note's inset.
        expect(roundRect).toHaveBeenCalledWith(351, rowY(60) + 1, 18, 14, 2);
        // devicePixelRatio 1, translated left by the scroll offset, so content
        // x 350 lands 50px into a canvas that starts at content x 300.
        expect(setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, -300, 0);
        // The cache window starts half a viewport before the scroll offset
        // (300 - 180), and is blitted at that same origin.
        expect(drawImage).toHaveBeenCalledWith(expect.anything(), -180, 0);
    });

    // Every repaint walks the whole note list, including every frame of a
    // scroll, so a clip long enough to need scrolling is mostly off-viewport
    // work unless the slice is culled.
    it('skips notes outside the drawn slice', () => {
        const roundRect = vi.spyOn(ctx, 'roundRect');
        mocks.midiState = {
            notesByClipId: {
                'clip-1': [
                    { id: 'near', pitch: 60, startBeat: 35, duration: 2, velocity: 127 },
                    { id: 'far', pitch: 60, startBeat: 3000, duration: 2, velocity: 127 },
                ],
            },
        };
        const deps = buildDeps({ scrollRef: scrollContainer(300) });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        expect(roundRect).toHaveBeenCalledWith(351, rowY(60) + 1, 18, 14, 2);
        expect(roundRect).not.toHaveBeenCalledWith(30_001, rowY(60) + 1, 18, 14, 2);
    });

    // A viewport-relative canvas that does not treat the scroll offset as a
    // repaint trigger freezes the whole picture while scrolling — the dirty
    // check would see identical notes, identical stores and an unchanged grid
    // key and skip the frame, leaving the previous slice on screen.
    it('repaints when only the scroll offset changed', () => {
        const drawImage = vi.spyOn(ctx, 'drawImage');
        const scrollRef = scrollContainer(0);
        const deps = buildDeps({ scrollRef });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();
        expect(drawImage).toHaveBeenCalledTimes(1);
        runTick();
        expect(drawImage).toHaveBeenCalledTimes(1);

        scrollRef.current.scrollLeft = 40;
        runTick();

        expect(drawImage).toHaveBeenCalledTimes(2);
    });

    // Scrolling must not re-stroke the grid every frame. The cache spans a
    // window wider than the viewport, so travel inside it costs a blit only;
    // leaving it rebuilds once. `drawBackground`'s fill is the cache rebuild's
    // own signature — it is the only full-height fillRect of the cache width.
    it('rebuilds the grid cache only when the scroll offset leaves the cached window', () => {
        const fillRect = vi.spyOn(ctx, 'fillRect');
        const scrollRef = scrollContainer(0);
        const deps = buildDeps({ scrollRef });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();
        const cacheWidth = VIEWPORT_W * 2;
        const rebuilds = (): number =>
            fillRect.mock.calls.filter((call) => call[2] === cacheWidth && call[3] === 982).length;
        expect(rebuilds()).toBe(1);

        // Inside the cached window: 40 frames of scrolling, no rebuild.
        for (let step = 1; step <= 40; step++) {
            scrollRef.current.scrollLeft = step * 4;
            runTick();
        }
        expect(rebuilds()).toBe(1);

        // Past the cached window's right edge → exactly one rebuild.
        scrollRef.current.scrollLeft = VIEWPORT_W * 2;
        runTick();
        expect(rebuilds()).toBe(2);
    });

    // Nothing is drawn into a backing store whose size is a lie: before the
    // scroll container is laid out its clientWidth is 0, which would otherwise
    // size the canvas from a negative viewport width.
    it('skips the frame while the scroll container has no measurable width', () => {
        const drawImage = vi.spyOn(ctx, 'drawImage');
        const deps = buildDeps({ scrollRef: scrollContainer(0, 0) });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        expect(drawImage).not.toHaveBeenCalled();
        expect(deps.canvasRef.current!.width).toBe(300); // untouched jsdom default
    });

    it('blits the cached grid on a repaint and skips repainting when nothing changed', () => {
        const drawImage = vi.spyOn(ctx, 'drawImage');
        const deps = buildDeps();
        renderHook(() => usePianoRollRenderer(deps));

        runTick();
        expect(drawImage).toHaveBeenCalledTimes(1);

        // Nothing changed → dirty checks all false → no second blit
        runTick();
        expect(drawImage).toHaveBeenCalledTimes(1);
    });

    it('the returned draw() invalidates the sentinels so the next tick repaints', () => {
        const drawImage = vi.spyOn(ctx, 'drawImage');
        const deps = buildDeps();
        const { result, rerender } = renderHook(() => usePianoRollRenderer(deps));

        runTick();
        runTick();
        expect(drawImage).toHaveBeenCalledTimes(1);

        // The live draw() lands in the ref inside the mount effect, after the
        // first render returned the initial noop — consumers (PianoRoll) pick
        // it up on their next render, so re-render before invoking it.
        rerender();
        result.current();
        runTick();
        expect(drawImage).toHaveBeenCalledTimes(2);
    });

    it('draws each active note of the clip at its beat/pitch cell', () => {
        const roundRect = vi.spyOn(ctx, 'roundRect');
        mocks.midiState = {
            notesByClipId: {
                'clip-1': [{ id: 'n1', pitch: 60, startBeat: 2, duration: 2, velocity: 127 }],
            },
        };
        const deps = buildDeps();
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        // x = 2 * 10 + 1, y = rowY(60) + 1, w = 2 * 10 - 2, h = ROW_HEIGHT - 2
        expect(roundRect).toHaveBeenCalledWith(21, rowY(60) + 1, 18, 14, 2);
    });

    it('renders the drag preview offset instead of the committed position during a move', () => {
        const roundRect = vi.spyOn(ctx, 'roundRect');
        mocks.midiState = {
            notesByClipId: {
                'clip-1': [{ id: 'n1', pitch: 60, startBeat: 2, duration: 2, velocity: 127 }],
            },
        };
        const deps = buildDeps({
            dragPreviewRef: { current: { noteIds: new Set(['n1']), beatDelta: 1, pitchDelta: 2 } },
        });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        // beat 2+1=3 → x 31; pitch 60+2=62 → y rowY(62)+1
        expect(roundRect).toHaveBeenCalledWith(31, rowY(62) + 1, 18, 14, 2);
        expect(roundRect).not.toHaveBeenCalledWith(21, rowY(60) + 1, 18, 14, 2);
    });

    it('applies a duration override during a right-edge resize preview', () => {
        const roundRect = vi.spyOn(ctx, 'roundRect');
        mocks.midiState = {
            notesByClipId: {
                'clip-1': [{ id: 'n1', pitch: 60, startBeat: 2, duration: 2, velocity: 127 }],
            },
        };
        const deps = buildDeps({
            dragPreviewRef: {
                current: {
                    noteIds: new Set(['n1']),
                    beatDelta: 0,
                    pitchDelta: 0,
                    durationOverride: new Map([['n1', 4]]),
                },
            },
        });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        // width = 4 * 10 - 2 at the original position
        expect(roundRect).toHaveBeenCalledWith(21, rowY(60) + 1, 38, 14, 2);
    });

    it('draws the drag-to-create preview rectangle', () => {
        const roundRect = vi.spyOn(ctx, 'roundRect');
        const deps = buildDeps({
            drawPreviewRef: { current: { beat: 1, pitch: 60, duration: 2 } },
        });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        expect(roundRect).toHaveBeenCalledWith(11, rowY(60) + 1, 18, 14, 2);
    });

    it('draws the rubber-band rectangle with a dashed stroke', () => {
        const strokeRect = vi.spyOn(ctx, 'strokeRect');
        const setLineDash = vi.spyOn(ctx, 'setLineDash');
        const deps = buildDeps({
            rubberBandRef: { current: { x: 5, y: 6, w: 7, h: 8 } },
        });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        expect(strokeRect).toHaveBeenCalledWith(5, 6, 7, 8);
        expect(setLineDash).toHaveBeenCalledWith([4, 4]);
    });

    it('draws the step cursor column when step input is active', () => {
        const fillRect = vi.spyOn(ctx, 'fillRect');
        const setLineDash = vi.spyOn(ctx, 'setLineDash');
        const deps = buildDeps({ stepInput: true, stepBeat: 4, stepPitch: 60 });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        expect(setLineDash).toHaveBeenCalledWith([4, 3]);
        // Column fill: x = stepBeat * beatWidth, width = gridSnap * beatWidth, full note area
        expect(fillRect).toHaveBeenCalledWith(40, 0, 10, 960);
        // Row highlight for the step pitch
        expect(fillRect).toHaveBeenCalledWith(0, rowY(60), 360, 16);
    });

    it('draws ghost notes from other MIDI tracks only when the toggle is on', () => {
        const roundRect = vi.spyOn(ctx, 'roundRect');
        mocks.midiState = {
            notesByClipId: {
                'clip-ghost': [{ id: 'g1', pitch: 70, startBeat: 0, duration: 1, velocity: 100 }],
            },
        };
        mocks.trackState = {
            tracks: [
                { id: 'track-1', kind: 'midi', color: 'oklch(0.5 0.1 200)', clips: [] },
                {
                    id: 'track-2',
                    kind: 'midi',
                    color: 'oklch(0.6 0.1 100)',
                    clips: [{ id: 'clip-ghost', type: 'midi', color: '' }],
                },
            ],
        };

        const deps = buildDeps({ showGhostNotes: true });
        renderHook(() => usePianoRollRenderer(deps));
        runTick();
        expect(roundRect).toHaveBeenCalledWith(1, rowY(70) + 1, 8, 14, 2);

        roundRect.mockClear();
        const depsOff = buildDeps({ showGhostNotes: false });
        renderHook(() => usePianoRollRenderer(depsOff));
        runTick();
        expect(roundRect).not.toHaveBeenCalledWith(1, rowY(70) + 1, 8, 14, 2);
    });

    it('draws notes of other simultaneously opened clips', () => {
        const roundRect = vi.spyOn(ctx, 'roundRect');
        mocks.midiState = {
            notesByClipId: {
                'clip-2': [{ id: 'o1', pitch: 65, startBeat: 4, duration: 2, velocity: 100 }],
            },
        };
        mocks.trackState = {
            tracks: [
                {
                    id: 'track-1',
                    kind: 'midi',
                    color: 'oklch(0.5 0.1 200)',
                    clips: [{ id: 'clip-2', type: 'midi', color: 'oklch(0.7 0.1 20)' }],
                },
            ],
        };
        const deps = buildDeps({ openedClipIds: ['clip-2'] });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        expect(roundRect).toHaveBeenCalledWith(41, rowY(65) + 1, 18, 14, 2);
    });

    it('applies drag preview offsets to secondary opened clip notes during drag', () => {
        const roundRect = vi.spyOn(ctx, 'roundRect');
        mocks.midiState = {
            notesByClipId: {
                'clip-2': [{ id: 'o1', pitch: 65, startBeat: 4, duration: 2, velocity: 100 }],
            },
        };
        mocks.trackState = {
            tracks: [
                {
                    id: 'track-1',
                    kind: 'midi',
                    color: 'oklch(0.5 0.1 200)',
                    clips: [{ id: 'clip-2', type: 'midi', color: 'oklch(0.7 0.1 20)' }],
                },
            ],
        };
        const deps = buildDeps({
            openedClipIds: ['clip-2'],
            dragPreviewRef: {
                current: {
                    noteIds: new Set(['o1']),
                    beatDelta: 2,
                    pitchDelta: 1,
                },
            },
        });
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        expect(roundRect).toHaveBeenCalledWith(61, rowY(66) + 1, 18, 14, 2);
    });

    it('cancels the animation frame loop on unmount', () => {
        const deps = buildDeps();
        const { unmount } = renderHook(() => usePianoRollRenderer(deps));

        unmount();

        expect(cancelRaf).toHaveBeenCalled();
    });
});
