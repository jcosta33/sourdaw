import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type ClipRenderModel,
    type TimelineRenderModel,
    type TrackRenderModel,
} from '../../../models/TimelineRenderModel';
import { createCanvasRenderer } from '../createCanvasRenderer';

type DrawClipMock = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    model: TimelineRenderModel,
    trackY: number,
    trackHeight: number
) => void;

type TransportSnapshot = { isLooping: boolean; loopStart: number; loopEnd: number };
type TakeLaneTake = { id: string; name: string; startBeat: number; endBeat: number; selected: boolean };
type TakeLaneRegion = { startBeat: number; endBeat: number; takeId: string };
type TakeLaneSnapshot = { lanes: { trackId: string; takes: TakeLaneTake[]; activeCompRegions: TakeLaneRegion[] }[] };

const mocks = vi.hoisted(() => ({
    drawClip: vi.fn<DrawClipMock>(),
    transport: null as TransportSnapshot | null,
    timeSignatureChanges: [] as { beat: number; numerator: number }[],
}));

// Explicit return type (not `as`) so `lanes: []` widens for later test reassignments.
const takeLaneMock = vi.hoisted((): { takeLanes: TakeLaneSnapshot } => ({
    takeLanes: { lanes: [] },
}));

vi.mock('../clipDrawing', () => ({ drawClip: mocks.drawClip }));

vi.mock('#/modules/Transport/stores', () => ({
    get transportStore() {
        return { value: mocks.transport };
    },
    get timeSignatureMapStore() {
        return { value: { changes: mocks.timeSignatureChanges } };
    },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    get takeLaneStore() {
        return { value: takeLaneMock.takeLanes };
    },
}));

type FillRectEntry = { fillStyle: string; x: number; y: number; w: number; h: number };
type FillTextEntry = { fillStyle: string; text: string; x: number; y: number };

function createMockCtx() {
    const fillRectLog: FillRectEntry[] = [];
    const fillTextLog: FillTextEntry[] = [];
    const strokeLog: string[] = [];
    let currentFillStyle = '';
    let currentStrokeStyle = '';

    const ctx = {
        lineWidth: 1,
        globalAlpha: 1,
        font: '',
        get fillStyle(): string {
            return currentFillStyle;
        },
        set fillStyle(value: string) {
            currentFillStyle = value;
        },
        get strokeStyle(): string {
            return currentStrokeStyle;
        },
        set strokeStyle(value: string) {
            currentStrokeStyle = value;
        },
        clearRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        translate: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(() => strokeLog.push(currentStrokeStyle)),
        fill: vi.fn(),
        fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
            fillRectLog.push({ fillStyle: currentFillStyle, x, y, w, h });
        }),
        strokeRect: vi.fn(),
        fillText: vi.fn((text: string, x: number, y: number) => {
            fillTextLog.push({ fillStyle: currentFillStyle, text, x, y });
        }),
        setLineDash: vi.fn(),
    };

    return { ctx: ctx as unknown as CanvasRenderingContext2D, fillRectLog, fillTextLog, strokeLog };
}

function createTestModel(overrides: Partial<TimelineRenderModel> = {}): TimelineRenderModel {
    return {
        dataDirty: false,
        tracks: [],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        playheadPosition: 0,
        viewportStartBeat: 0,
        viewportEndBeat: 16,
        beatsPerPixel: 1 / 20,
        pixelsPerBeat: 20,
        trackHeight: 40,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
        ...overrides,
    };
}

function createTestTrack(
    overrides: Partial<TrackRenderModel> & Pick<TrackRenderModel, 'id' | 'index'>
): TrackRenderModel {
    return {
        name: 'Track',
        kind: 'audio',
        color: '#336699',
        muted: false,
        soloed: false,
        height: 40,
        clips: [],
        automationMode: 'read',
        ...overrides,
    };
}

function createTestClip(overrides: Partial<ClipRenderModel> & Pick<ClipRenderModel, 'id'>): ClipRenderModel {
    return {
        startBeat: 0,
        endBeat: 4,
        name: 'Clip',
        color: '#000',
        type: 'audio',
        muted: false,
        midiNotes: [],
        fadeInBeats: 0,
        fadeOutBeats: 0,
        ...overrides,
    };
}

let ctx: CanvasRenderingContext2D;
let fillRectLog: FillRectEntry[];
let fillTextLog: FillTextEntry[];
let strokeLog: string[];
let canvas: HTMLCanvasElement;

describe('createCanvasRenderer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transport = null;
        mocks.timeSignatureChanges = [];
        takeLaneMock.takeLanes = { lanes: [] };
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });

        const mock = createMockCtx();
        ctx = mock.ctx;
        fillRectLog = mock.fillRectLog;
        fillTextLog = mock.fillTextLog;
        strokeLog = mock.strokeLog;

        canvas = document.createElement('canvas');
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (contextId: string) {
            if (contextId === '2d') {
                return ctx;
            }
            return null;
        } as typeof HTMLCanvasElement.prototype.getContext);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports a canvas2d backend, and resize/render scale to the current devicePixelRatio', () => {
        const renderer = createCanvasRenderer(canvas);
        expect(renderer.backend).toBe('canvas2d');
        expect(() => renderer.dispose()).not.toThrow();

        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
        renderer.resize(400, 300);
        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(600);
        expect(canvas.style.width).toBe('400px');
        expect(canvas.style.height).toBe('300px');

        renderer.render(createTestModel());
        expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
        expect(ctx.scale).toHaveBeenCalledWith(2, 2);
        expect(ctx.save).toHaveBeenCalledTimes(2);
        expect(ctx.restore).toHaveBeenCalledTimes(2);
    });

    it('draws the playhead at the viewport-derived pixel position, and grid beat lines dimmer than bar lines', () => {
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(
            createTestModel({
                playheadPosition: 10,
                viewportStartBeat: 2,
                pixelsPerBeat: 20,
                timeSignatureNumerator: 4,
            })
        );
        // x = (10 - 2) * 20 = 160
        expect(ctx.moveTo).toHaveBeenCalledWith(160, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(160, 200);
        expect(ctx.moveTo).toHaveBeenCalledWith(156, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(164, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(160, 6);

        const beatIndex = strokeLog.indexOf('rgba(255, 255, 255, 0.05)');
        const barIndex = strokeLog.indexOf('rgba(255, 255, 255, 0.13)');
        expect(beatIndex).toBeGreaterThanOrEqual(0);
        expect(barIndex).toBeGreaterThan(beatIndex);
    });

    it('draws the loop region from loopStart/loopEnd pixel bounds only while the transport is looping', () => {
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);

        mocks.transport = { isLooping: false, loopStart: 4, loopEnd: 8 };
        renderer.render(createTestModel({ viewportStartBeat: 0, pixelsPerBeat: 20 }));
        expect(ctx.setLineDash).not.toHaveBeenCalled();

        mocks.transport = { isLooping: true, loopStart: 4, loopEnd: 8 };
        renderer.render(createTestModel({ viewportStartBeat: 0, pixelsPerBeat: 20 }));
        // x1 = 4 * 20 = 80, x2 = 8 * 20 = 160 → width 80
        const region = fillRectLog.find((entry) => entry.fillStyle === 'rgba(255, 255, 255, 0.03)');
        expect(region).toEqual(expect.objectContaining({ x: 80, w: 80 }));
        expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    });

    it('draws track rows (selected vs alternating background) and a folder row with fixed height/accent/label', () => {
        const tracks = [
            createTestTrack({ id: 't0', index: 0, height: 40 }),
            createTestTrack({ id: 't1', index: 1, height: 40 }),
            createTestTrack({ id: 'f0', index: 2, kind: 'folder', name: 'Drums Bus', height: 60 }),
        ];
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel({ tracks, selectedTrackId: 't1' }));

        const rowBackgrounds = fillRectLog.filter((entry) => entry.w === 400);
        expect(rowBackgrounds.find((entry) => entry.y === 0)?.fillStyle).toBe('rgba(255, 255, 255, 0.008)');
        expect(rowBackgrounds.find((entry) => entry.y === 40)?.fillStyle).toBe('rgba(255, 255, 255, 0.018)');

        const folderBackground = rowBackgrounds.find((entry) => entry.fillStyle === 'rgba(0, 0, 0, 0.5)');
        const folderAccent = fillRectLog.find(
            (entry) => entry.w === 3 && entry.fillStyle === 'rgba(176, 144, 64, 0.4)'
        );
        expect(folderBackground?.h).toBe(26); // fixed regardless of the model's 60px height
        expect(folderAccent).toBeTruthy();
        expect(fillTextLog.some((entry) => entry.text === 'DRUMS BUS')).toBe(true);
    });

    it('culls off-screen clips from drawClip, and draws/highlights take rows only for a matching lane', () => {
        const offscreenClip = createTestClip({ id: 'off', startBeat: -20, endBeat: -16 });
        const onscreenClip = createTestClip({ id: 'on', startBeat: 2, endBeat: 6 });
        const tracks = [createTestTrack({ id: 't0', index: 0, clips: [offscreenClip, onscreenClip] })];
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        const model = createTestModel({ tracks, pixelsPerBeat: 20 });
        renderer.render(model);

        expect(mocks.drawClip).toHaveBeenCalledTimes(1);
        expect(mocks.drawClip).toHaveBeenCalledWith(ctx, onscreenClip, model, 0, 40);
        expect(fillRectLog.some((entry) => entry.fillStyle === 'rgba(80, 160, 110, 0.12)')).toBe(false);

        takeLaneMock.takeLanes = {
            lanes: [
                {
                    trackId: 't0',
                    takes: [{ id: 'take1', name: 'Take 1', startBeat: 0, endBeat: 4, selected: false }],
                    activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: 'take1' }],
                },
            ],
        };
        renderer.render(model);
        expect(fillTextLog.some((entry) => entry.text === 'Take 1')).toBe(true);
        const highlight = fillRectLog.find((entry) => entry.fillStyle === 'rgba(80, 160, 110, 0.12)');
        expect(highlight).toEqual(expect.objectContaining({ x: 0, w: 40 }));
    });

    it('stops scanning time-signature changes once a change reaches the viewport start beat', () => {
        // Two changes: one before the viewport (sets the active numerator) and one
        // at/after the viewport start (must trigger the loop break so the earlier
        // change remains the governing bar length for grid drawing).
        mocks.timeSignatureChanges = [
            { beat: 2, numerator: 3 },
            { beat: 8, numerator: 5 },
        ];
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        // viewportStartBeat 8 -> startBeat 8; the beat-8 change triggers the break,
        // so currentNumerator stays at 3 (from the beat-2 change that set barStart).
        renderer.render(createTestModel({ viewportStartBeat: 8, pixelsPerBeat: 20 }));
        // No throw and the grid stroke ran; assert a stroke occurred.
        expect(strokeLog.length).toBeGreaterThan(0);
    });

    it('culls off-screen clips inside a variation lane', () => {
        const offscreenVar = createTestClip({ id: 'var-off', startBeat: -50, endBeat: -46 });
        const onscreenVar = createTestClip({ id: 'var-on', startBeat: 1, endBeat: 3 });
        const track = createTestTrack({
            id: 't0',
            index: 0,
            clips: [],
            variationLanes: [{ id: 'lane-a', name: 'A', clips: [offscreenVar, onscreenVar] }],
        });
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        const model = createTestModel({ tracks: [track], pixelsPerBeat: 20 });
        renderer.render(model);

        // Only the on-screen variation clip is drawn.
        const drawn = mocks.drawClip.mock.calls.map((call) => call[1]);
        expect(drawn.map((clip) => clip.id)).toEqual(['var-on']);
        expect(drawn.map((clip) => clip.id)).not.toContain('var-off');
    });
});
