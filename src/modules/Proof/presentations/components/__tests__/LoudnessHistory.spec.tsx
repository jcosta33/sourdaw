import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { LoudnessHistory } from '../LoudnessHistory';

const yForDb = (db: number, height: number): number => ((db - 0) / (-60 - 0)) * height;

const HIGHLIGHT = 'rgba(255,255,255,0.06)';
const FAINT = 'rgba(255,255,255,0.035)';

const CAPACITY = 300;

type GridLine = { strokeStyle: string; y: number };

const captureGridLines = (height: number): GridLine[] => {
    const lines: GridLine[] = [];
    const original = HTMLCanvasElement.prototype.getContext;

    let strokeStyle = '';
    const ctx = {
        get strokeStyle(): string {
            return strokeStyle;
        },
        set strokeStyle(value: string) {
            strokeStyle = value;
        },
        fillStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: 'start',
        shadowColor: '',
        shadowBlur: 0,
        canvas: {} as HTMLCanvasElement,
        scale: (): void => {},
        clearRect: (): void => {
            lines.length = 0;
        },
        fillRect: (): void => {},
        fillText: (): void => {},
        beginPath: (): void => {},
        closePath: (): void => {},
        moveTo: (_x: number, y: number): void => {
            if (strokeStyle === HIGHLIGHT || strokeStyle === FAINT) {
                lines.push({ strokeStyle, y });
            }
        },
        lineTo: (): void => {},
        stroke: (): void => {},
        fill: (): void => {},
        save: (): void => {},
        restore: (): void => {},
        setLineDash: (): void => {},
        createLinearGradient: () => ({ addColorStop: (): void => {} }),
    } as unknown as CanvasRenderingContext2D;

    // @ts-expect-error — narrow override for the '2d' path only
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
        if (id === '2d') {
            (ctx as { canvas: HTMLCanvasElement }).canvas = this;
            return ctx;
        }
        return null;
    };

    try {
        render(
            <LoudnessHistory
                samples={[]}
                capacity={CAPACITY}
                targetLufs={-14}
                integratedLufs={-13}
                width={200}
                height={height}
            />
        );
    } finally {
        HTMLCanvasElement.prototype.getContext = original;
    }

    return lines;
};

/**
 * Counts the points of the plotted history.
 *
 * The graph paints the retained samples twice — a filled area, then a stroked
 * line. The stroke is the last path built, so the moves recorded after the
 * final `beginPath` and before the `save` that precedes it are exactly one
 * entry per plotted sample.
 */
type PlottedPathRecorder = {
    plottedPoints: () => number;
    restore: () => void;
};

const recordPlottedPath = (): PlottedPathRecorder => {
    const original = HTMLCanvasElement.prototype.getContext;
    const operations: string[] = [];

    const record = (name: string) => (): void => {
        operations.push(name);
    };

    const ctx = {
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: 'start',
        shadowColor: '',
        shadowBlur: 0,
        canvas: {} as HTMLCanvasElement,
        scale: (): void => {},
        clearRect: (): void => {},
        fillRect: (): void => {},
        fillText: (): void => {},
        beginPath: record('beginPath'),
        closePath: record('closePath'),
        moveTo: record('moveTo'),
        lineTo: record('lineTo'),
        stroke: record('stroke'),
        fill: record('fill'),
        save: record('save'),
        restore: (): void => {},
        setLineDash: (): void => {},
        createLinearGradient: () => ({ addColorStop: (): void => {} }),
    } as unknown as CanvasRenderingContext2D;

    // @ts-expect-error — narrow override for the '2d' path only
    HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
        if (id === '2d') {
            (ctx as { canvas: HTMLCanvasElement }).canvas = this;
            return ctx;
        }
        return null;
    };

    return {
        plottedPoints: () => {
            const lastBeginPath = operations.lastIndexOf('beginPath');
            if (lastBeginPath === -1) {
                return 0;
            }
            const end = operations.indexOf('save', lastBeginPath);
            const path = operations.slice(lastBeginPath + 1, end === -1 ? operations.length : end);
            return path.filter((operation) => operation === 'moveTo' || operation === 'lineTo').length;
        },
        restore: () => {
            HTMLCanvasElement.prototype.getContext = original;
        },
    };
};

describe('LoudnessHistory', () => {
    it('should render', () => {
        const { container } = render(
            <LoudnessHistory
                samples={[]}
                capacity={CAPACITY}
                targetLufs={-14}
                integratedLufs={-13}
                width={200}
                height={48}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('highlights exactly the -24 dB gridline (no spurious highlight)', () => {
        const height = 48;
        const lines = captureGridLines(height);
        const highlighted = lines.filter((line) => line.strokeStyle === HIGHLIGHT);
        expect(highlighted).toHaveLength(1);
        expect(highlighted[0]!.y).toBeCloseTo(yForDb(-24, height), 5);
    });

    it('does not highlight any gridline at the -14 dB position', () => {
        const height = 48;
        const lines = captureGridLines(height);
        const at14 = lines.find((line) => Math.abs(line.y - yForDb(-14, height)) < 1e-6);
        expect(at14).toBeUndefined();
    });
});

describe('LoudnessHistory — canvas attributes', () => {
    it('renders with aria-label', () => {
        const { container } = render(
            <LoudnessHistory
                samples={[]}
                capacity={CAPACITY}
                targetLufs={-14}
                integratedLufs={-13}
                width={200}
                height={48}
            />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('aria-label')).toBe('Loudness history graph');
    });

    it('applies width and height to the canvas style', () => {
        const { container } = render(
            <LoudnessHistory
                samples={[]}
                capacity={CAPACITY}
                targetLufs={-14}
                integratedLufs={-13}
                width={300}
                height={80}
            />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('style')).toContain('width: 300px');
        expect(canvas?.getAttribute('style')).toContain('height: 80px');
    });
});

describe('LoudnessHistory — grid line coverage', () => {
    it('draws gridlines at all 6 dB reference levels', () => {
        const height = 60;
        const lines = captureGridLines(height);
        // 6 gridlines at -6, -12, -18, -24, -36, -48
        expect(lines.length).toBe(6);
        for (const db of [-6, -12, -18, -24, -36, -48]) {
            const expectedY = yForDb(db, height);
            expect(lines.some((l) => Math.abs(l.y - expectedY) < 1e-5)).toBe(true);
        }
    });
});

describe('LoudnessHistory — plotted samples', () => {
    it('plots exactly the samples it is given', () => {
        const recorder = recordPlottedPath();

        try {
            const { rerender } = render(
                <LoudnessHistory
                    samples={[-12, -13, -14]}
                    capacity={CAPACITY}
                    targetLufs={-14}
                    integratedLufs={-13}
                    width={200}
                    height={48}
                />
            );
            expect(recorder.plottedPoints()).toBe(3);

            // The graph owns no clock and no buffer: a redraw with a different
            // target or size cannot change how many points exist.
            rerender(
                <LoudnessHistory
                    samples={[-12, -13, -14]}
                    capacity={CAPACITY}
                    targetLufs={-9}
                    integratedLufs={-11}
                    width={260}
                    height={64}
                />
            );
            expect(recorder.plottedPoints()).toBe(3);

            rerender(
                <LoudnessHistory
                    samples={[-12, -13, -14, -15, -16]}
                    capacity={CAPACITY}
                    targetLufs={-14}
                    integratedLufs={-13}
                    width={200}
                    height={48}
                />
            );
            expect(recorder.plottedPoints()).toBe(5);
        } finally {
            recorder.restore();
        }
    });

    it('spaces the plot across the stated capacity, not the sample count', () => {
        const xs: number[] = [];
        const original = HTMLCanvasElement.prototype.getContext;
        const ctx = {
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            font: '',
            textAlign: 'start',
            shadowColor: '',
            shadowBlur: 0,
            canvas: {} as HTMLCanvasElement,
            scale: (): void => {},
            clearRect: (): void => {
                xs.length = 0;
            },
            fillRect: (): void => {},
            fillText: (): void => {},
            beginPath: (): void => {},
            closePath: (): void => {},
            moveTo: (x: number): void => {
                xs.push(x);
            },
            lineTo: (x: number): void => {
                xs.push(x);
            },
            stroke: (): void => {},
            fill: (): void => {},
            save: (): void => {},
            restore: (): void => {},
            setLineDash: (): void => {},
            createLinearGradient: () => ({ addColorStop: (): void => {} }),
        } as unknown as CanvasRenderingContext2D;

        // @ts-expect-error — narrow override for the '2d' path only
        HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
            if (id === '2d') {
                (ctx as { canvas: HTMLCanvasElement }).canvas = this;
                return ctx;
            }
            return null;
        };

        try {
            render(
                <LoudnessHistory
                    samples={[-12, -13]}
                    capacity={100}
                    targetLufs={-100}
                    integratedLufs={-100}
                    width={200}
                    height={48}
                />
            );
        } finally {
            HTMLCanvasElement.prototype.getContext = original;
        }

        // Two samples out of a hundred slots occupy the last 2% of the width, so
        // a half-full window reads as a half-full window rather than a full one.
        const step = 200 / 100;
        expect(xs).toContain(200 - 2 * step);
        expect(xs).toContain(200 - step);
    });
});
