import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ClipRenderModel, type TimelineRenderModel, type TrackRenderModel } from '../../../models/TimelineRenderModel';
import { createCanvasRenderer } from '../createCanvasRenderer';

type DrawClipMock = (
    ctx: CanvasRenderingContext2D,
    clip: ClipRenderModel,
    model: TimelineRenderModel,
    trackY: number,
    trackHeight: number
) => void;

type TransportSnapshot = { isLooping: boolean; loopStart: number; loopEnd: number };
type TakeLaneSnapshot = {
    lanes: {
        trackId: string;
        takes: { id: string; name: string; startBeat: number; endBeat: number; selected: boolean }[];
        activeCompRegions: { startBeat: number; endBeat: number; takeId: string }[];
    }[];
};

const mocks = vi.hoisted(() => ({
    drawClip: vi.fn<DrawClipMock>(),
    transport: null as TransportSnapshot | null,
    timeSignatureChanges: [] as { beat: number; numerator: number }[],
    takeLanes: { lanes: [] } as TakeLaneSnapshot,
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
        return { value: mocks.takeLanes };
    },
}));

type FillRectEntry = { fillStyle: string; x: number; y: number; w: number; h: number };
type FillTextEntry = { fillStyle: string; text: string; x: number; y: number };

function createMockCtx(): {
    ctx: CanvasRenderingContext2D;
    fillRectLog: FillRectEntry[];
    fillTextLog: FillTextEntry[];
    strokeLog: string[];
} {
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
        mocks.takeLanes = { lanes: [] };
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

    it('reports a canvas2d backend and exposes a no-op dispose', () => {
        const renderer = createCanvasRenderer(canvas);
        expect(renderer.backend).toBe('canvas2d');
        expect(() => renderer.dispose()).not.toThrow();
    });

    it('resize scales the backing store by devicePixelRatio and sets the CSS size', () => {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 300);
        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(600);
        expect(canvas.style.width).toBe('400px');
        expect(canvas.style.height).toBe('300px');
    });

    it('render clears and scales the context using the current size and devicePixelRatio', () => {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 300);
        renderer.render(createTestModel());
        expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
        expect(ctx.scale).toHaveBeenCalledWith(2, 2);
        expect(ctx.save).toHaveBeenCalledTimes(2);
        expect(ctx.restore).toHaveBeenCalledTimes(2);
    });

    it('draws the playhead line and direction triangle at the pixel position derived from the viewport', () => {
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel({ playheadPosition: 10, viewportStartBeat: 2, pixelsPerBeat: 20 }));
        // x = (10 - 2) * 20 = 160
        expect(ctx.moveTo).toHaveBeenCalledWith(160, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(160, 200);
        expect(ctx.moveTo).toHaveBeenCalledWith(156, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(164, 0);
        expect(ctx.lineTo).toHaveBeenCalledWith(160, 6);
    });

    it('draws grid beat lines dimmer than bar lines, in that order', () => {
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel({ pixelsPerBeat: 20, timeSignatureNumerator: 4 }));
        const beatIndex = strokeLog.indexOf('rgba(255, 255, 255, 0.05)');
        const barIndex = strokeLog.indexOf('rgba(255, 255, 255, 0.13)');
        expect(beatIndex).toBeGreaterThanOrEqual(0);
        expect(barIndex).toBeGreaterThan(beatIndex);
    });

    it('draws the loop region from loopStart/loopEnd pixel bounds while the transport is looping', () => {
        mocks.transport = { isLooping: true, loopStart: 4, loopEnd: 8 };
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel({ viewportStartBeat: 0, pixelsPerBeat: 20 }));
        // x1 = 4 * 20 = 80, x2 = 8 * 20 = 160 → width 80
        const region = fillRectLog.find((entry) => entry.fillStyle === 'rgba(255, 255, 255, 0.03)');
        expect(region).toEqual(expect.objectContaining({ x: 80, w: 80 }));
        expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    });

    it('skips the loop region entirely when the transport is not looping', () => {
        mocks.transport = { isLooping: false, loopStart: 4, loopEnd: 8 };
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel());
        expect(ctx.setLineDash).not.toHaveBeenCalled();
    });

    it('differentiates the selected track row from an unselected alternating row', () => {
        const tracks = [createTestTrack({ id: 't0', index: 0, height: 40 }), createTestTrack({ id: 't1', index: 1, height: 40 })];
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel({ tracks, selectedTrackId: 't1' }));

        const rowBackgrounds = fillRectLog.filter((entry) => entry.w === 400);
        expect(rowBackgrounds.find((entry) => entry.y === 0)?.fillStyle).toBe('rgba(255, 255, 255, 0.008)');
        expect(rowBackgrounds.find((entry) => entry.y === 40)?.fillStyle).toBe('rgba(255, 255, 255, 0.018)');
    });

    it('renders a folder track with a fixed 26px row, amber accent, dark background, and uppercase label', () => {
        const tracks = [createTestTrack({ id: 'f0', index: 0, kind: 'folder', name: 'Drums Bus', height: 60 })];
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel({ tracks }));

        const background = fillRectLog.find((entry) => entry.w === 400 && entry.fillStyle === 'rgba(0, 0, 0, 0.5)');
        const accent = fillRectLog.find((entry) => entry.w === 3 && entry.fillStyle === 'rgba(176, 144, 64, 0.4)');
        expect(background?.h).toBe(26);
        expect(accent).toBeTruthy();
        expect(fillTextLog.some((entry) => entry.text === 'DRUMS BUS')).toBe(true);
    });

    it('culls off-screen clips from drawClip while keeping on-screen ones', () => {
        const offscreenClip = createTestClip({ id: 'off', startBeat: -20, endBeat: -16 });
        const onscreenClip = createTestClip({ id: 'on', startBeat: 2, endBeat: 6 });
        const tracks = [createTestTrack({ id: 't0', index: 0, clips: [offscreenClip, onscreenClip] })];
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        const model = createTestModel({ tracks, pixelsPerBeat: 20 });
        renderer.render(model);

        expect(mocks.drawClip).toHaveBeenCalledTimes(1);
        expect(mocks.drawClip).toHaveBeenCalledWith(ctx, onscreenClip, model, 0, 40);
    });

    it('draws take rows and highlights comp regions only for tracks with a matching take lane', () => {
        mocks.takeLanes = {
            lanes: [
                {
                    trackId: 't0',
                    takes: [{ id: 'take1', name: 'Take 1', startBeat: 0, endBeat: 4, selected: false }],
                    activeCompRegions: [{ startBeat: 0, endBeat: 2, takeId: 'take1' }],
                },
            ],
        };
        const tracks = [createTestTrack({ id: 't0', index: 0, height: 40 })];
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel({ tracks, pixelsPerBeat: 20 }));

        expect(fillTextLog.some((entry) => entry.text === 'Take 1')).toBe(true);
        const highlight = fillRectLog.find((entry) => entry.fillStyle === 'rgba(80, 160, 110, 0.12)');
        expect(highlight).toEqual(expect.objectContaining({ x: 0, w: 40 }));
    });

    it('skips take lane drawing entirely when the store has no lanes', () => {
        const tracks = [createTestTrack({ id: 't0', index: 0 })];
        const renderer = createCanvasRenderer(canvas);
        renderer.resize(400, 200);
        renderer.render(createTestModel({ tracks }));
        expect(fillRectLog.some((entry) => entry.fillStyle === 'rgba(80, 160, 110, 0.12)')).toBe(false);
    });
});
