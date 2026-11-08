import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Wavetable3D } from '../Wavetable3D';

type Point = [number, number];

describe('Wavetable3D', () => {
    let strokes: Point[][];
    let labels: string[];
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
        strokes = [];
        labels = [];
        originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = (() => {
            let points: Point[] = [];
            return {
                clearRect: vi.fn(),
                fillRect: vi.fn(),
                closePath: vi.fn(),
                fill: vi.fn(),
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 0,
                font: '',
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
                    strokes.push([...points]);
                },
                fillText: (text: string) => {
                    labels.push(text);
                },
            };
        }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    });

    afterEach(() => {
        cleanup();
        HTMLCanvasElement.prototype.getContext = originalGetContext;
    });

    it('draws supplied frames in depth order and redraws changed frames without mutating them', () => {
        const frames = [new Float32Array([-1, 0, 1, 0]), new Float32Array([0.5, -0.5, 0, 1])];
        const originals = frames.map((frame) => Array.from(frame));
        const view = render(<Wavetable3D frames={frames} width={200} height={100} color="#336699" />);
        expect(screen.getByRole('img', { name: 'Wavetable 3D display' })).toBeInTheDocument();
        expect(strokes).toEqual([
            [
                [15, 20],
                [50, 70],
                [85, 45],
                [120, -5],
            ],
            [
                [0, 120],
                [35, 70],
                [70, 20],
                [105, 70],
            ],
        ]);
        expect(labels).toEqual(['2 frames']);
        expect(frames.map((frame) => Array.from(frame))).toEqual(originals);

        const changed = [new Float32Array(4), new Float32Array(4)];
        view.rerender(<Wavetable3D frames={changed} width={200} height={100} color="#336699" />);
        expect(strokes.slice(2)).toEqual([
            [
                [15, 45],
                [50, 45],
                [85, 45],
                [120, 45],
            ],
            [
                [0, 70],
                [35, 70],
                [70, 70],
                [105, 70],
            ],
        ]);
        expect(labels).toEqual(['2 frames', '2 frames']);
        expect(frames.map((frame) => Array.from(frame))).toEqual(originals);
        expect(changed.map((frame) => Array.from(frame))).toEqual([
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ]);
    });
});
