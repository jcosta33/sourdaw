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
// No track/clip in the store for clipId/trackId → clip length 0, no notes →
// extentBeats = getPianoRollExtentBeats(0, []) = GRID_BEATS(32) floor,
// already a bar boundary, + 1 trailing bar (4 beats) = 36.
// beatWidth 10 → totalWidth = 36 * 10 = 360 (canvas has no parent).
// height = 60 * 16 + RULER(22) = 982. Note x = startBeat * 10, y = (83 - pitch) * 16.
const BEAT_W = 10;

const rowY = (pitch: number): number => (83 - pitch) * 16;

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

    it('sizes the canvas backing store to the full grid on the first tick', () => {
        const deps = buildDeps();
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        const canvas = deps.canvasRef.current!;
        expect(canvas.width).toBe(360);
        expect(canvas.height).toBe(982);
        expect(canvas.style.width).toBe('360px');
        expect(canvas.style.height).toBe('982px');
    });

    // Issue #2299: the renderer used to size the canvas from the fixed
    // GRID_BEATS constant alone, so a clip longer than the floor had its
    // tail drawn outside the canvas backing store. The extent must be looked
    // up from the clip owning `clipId`/`trackId`, not just the note list.
    it("sizes the canvas to the clip's own extent when it is longer than the GRID_BEATS floor", () => {
        mocks.trackState = {
            tracks: [
                {
                    id: 'track-1',
                    kind: 'midi',
                    color: 'oklch(0.5 0.1 200)',
                    clips: [{ id: 'clip-1', type: 'midi', color: '', startBeat: 0, endBeat: 40 }],
                },
            ],
        };
        const deps = buildDeps();
        renderHook(() => usePianoRollRenderer(deps));

        runTick();

        // clip length 40, no notes, GRID_BEATS floor 32 → max is 40, already
        // a bar boundary, + 1 trailing bar (4) = 44 beats. beatWidth 10 → 440.
        const canvas = deps.canvasRef.current!;
        expect(canvas.width).toBe(440);
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

    it('cancels the animation frame loop on unmount', () => {
        const deps = buildDeps();
        const { unmount } = renderHook(() => usePianoRollRenderer(deps));

        unmount();

        expect(cancelRaf).toHaveBeenCalled();
    });
});
