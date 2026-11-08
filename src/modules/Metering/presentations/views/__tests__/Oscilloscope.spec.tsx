import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { getMasterAnalyser, getTrackAnalyser } from '#/modules/AudioEngine/useCases';

import { Oscilloscope } from '../Oscilloscope';

type Point = [number, number];
type Stroke = { color: string; width: number; points: Point[] };
const analyser = (samples: number[]) => ({
    frequencyBinCount: 4,
    getFloatTimeDomainData: vi.fn((data: Float32Array) => data.set(samples)),
});
let master = analyser([-1, 0, 1, 0.5]);
let track: ReturnType<typeof analyser> | null = analyser([-1, 0, 1, 0.5]);
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: vi.fn(() => master),
    getTrackAnalyser: vi.fn(() => track),
}));

describe('Oscilloscope waveform', () => {
    let strokes: Stroke[];
    let callbacks: FrameRequestCallback[];
    let cancelled: number[];
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
        vi.clearAllMocks();
        master = analyser([-1, 0, 1, 0.5]);
        track = analyser([-1, 0, 1, 0.5]);
        strokes = [];
        callbacks = [];
        cancelled = [];
        originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = (() => {
            let points: Point[] = [];
            const context = {
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 0,
                shadowColor: '',
                shadowBlur: 0,
                globalAlpha: 1,
                fillRect: vi.fn(),
                drawImage: vi.fn(),
                setLineDash: vi.fn(),
                beginPath: () => {
                    points = [];
                },
                moveTo: (x: number, y: number) => {
                    points.push([x, y]);
                },
                lineTo: (x: number, y: number) => {
                    points.push([x, y]);
                },
                stroke: () => {
                    strokes.push({ color: context.strokeStyle, width: context.lineWidth, points: [...points] });
                },
            };
            return context;
        }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            cancelled.push(id);
        });
    });

    afterEach(() => {
        cleanup();
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        vi.unstubAllGlobals();
    });

    it('draws track data, rereads on the next frame and cancels the pending frame', () => {
        const view = render(
            <TooltipProvider>
                <Oscilloscope trackId="track-7" width={200} height={80} color="#336699" />
            </TooltipProvider>
        );
        const sharp = () => strokes.filter((stroke) => stroke.color === '#336699' && stroke.width === 1.5);
        expect(getTrackAnalyser).toHaveBeenCalledWith('track-7');
        expect(getMasterAnalyser).not.toHaveBeenCalled();
        expect(sharp().map((stroke) => stroke.points)).toEqual([
            [
                [0, 76],
                [50, 40],
                [100, 4],
                [150, 22],
            ],
        ]);
        track!.getFloatTimeDomainData.mockImplementation((data) => data.set([1, 0, -1, -0.5]));
        expect(callbacks).toHaveLength(1);
        callbacks[0]!(0);
        expect(sharp().map((stroke) => stroke.points)).toEqual([
            [
                [0, 76],
                [50, 40],
                [100, 4],
                [150, 22],
            ],
            [
                [0, 4],
                [50, 40],
                [100, 76],
                [150, 58],
            ],
        ]);
        expect(track!.getFloatTimeDomainData).toHaveBeenCalledTimes(2);
        expect(callbacks).toHaveLength(2);
        view.unmount();
        expect(cancelled).toEqual([2]);
    });

    it('reads master data when the requested track has no analyser', () => {
        track = null;
        render(
            <TooltipProvider>
                <Oscilloscope trackId="missing" width={200} height={80} color="#336699" />
            </TooltipProvider>
        );
        expect(getTrackAnalyser).toHaveBeenCalledWith('missing');
        expect(getMasterAnalyser).toHaveBeenCalledOnce();
        expect(master.getFloatTimeDomainData).toHaveBeenCalledOnce();
        expect(strokes.find((stroke) => stroke.color === '#336699' && stroke.width === 1.5)?.points).toEqual([
            [0, 76],
            [50, 40],
            [100, 4],
            [150, 22],
        ]);
    });
});
